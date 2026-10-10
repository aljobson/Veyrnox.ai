// /api/v1/admin/appeals (ADR-0083): the appeals queue. Same gates as the
// other dashboard routes, strict input shapes, decisions keyed by the form's
// Idempotency-Key, and the user is emailed once per new decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/admin/appeals/route.js', import.meta.url);
const APPEAL = '44444444-4444-4444-8444-444444444444';
const USER = '11111111-1111-4111-8111-111111111111';
const KEY = 'a1b2c3d4-0000-4000-8000-000000000002';
const ADMIN = { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2', 'idempotency-key': KEY };
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true' };

async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${route.href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
const request = (method, headers, body, query = '') => new Request(`https://veyrnox.test/api/v1/admin/appeals${query}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
});
function stubRpc(handler) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        const body = init && init.body ? JSON.parse(init.body) : null;
        calls.push({ url: u, body });
        return handler(u, body);
    };
    return calls;
}
const realError = console.error;
test.before(() => { console.error = () => {}; });
test.after(() => { console.error = realError; });

test('unauthenticated, aal1 and unconfigured callers are refused before any RPC', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ GET, POST }) => {
        assert.equal((await GET(request('GET', {}))).status, 401);
        assert.equal((await POST(request('POST', {}, { appeal_id: APPEAL, decision: 'upheld', reason: 'okay' }))).status, 401);
        const aal1 = await GET(request('GET', { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal1' }));
        assert.deepEqual([aal1.status, await aal1.json()], [403, { error: 'mfa_required' }]);
    });
    await withEnv({ ...CONFIGURED, SUPABASE_URL: undefined }, async ({ GET }) => {
        assert.equal((await GET(request('GET', ADMIN))).status, 503);
    });
    assert.equal(calls.length, 0);
});

test('GET lists open appeals by default, passes a status filter, and refuses an unknown one', async () => {
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/list_content_appeals$/);
        return Response.json({ ok: true, appeals: [{ id: APPEAL, status: 'open' }] });
    });
    await withEnv(CONFIGURED, async ({ GET }) => {
        const res = await GET(request('GET', ADMIN));
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { appeals: [{ id: APPEAL, status: 'open' }] });
        await GET(request('GET', ADMIN, undefined, '?status=rejected&limit=20'));
        await GET(request('GET', ADMIN, undefined, '?status=all'));
        const bad = await GET(request('GET', ADMIN, undefined, '?status=pending'));
        assert.deepEqual([bad.status, (await bad.json()).error], [400, 'status_invalid']);
    });
    assert.deepEqual(calls.map((c) => [c.body.p_status, c.body.p_limit]), [['open', 50], ['rejected', 20], [null, 50]]);
});

test('POST validates the body and the Idempotency-Key before the RPC', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ POST }) => {
        for (const [body, error] of [
            [{ decision: 'upheld', reason: 'okay' }, 'appeal_id_invalid'],
            [{ appeal_id: APPEAL, decision: 'maybe', reason: 'ok' }, 'decision_invalid'],
            [{ appeal_id: APPEAL, decision: 'upheld', reason: ' ' }, 'reason_invalid'],
            [{ appeal_id: APPEAL, decision: 'upheld', reason: 'x'.repeat(501) }, 'reason_invalid'],
            [[1], 'body_invalid'],
        ]) {
            const res = await POST(request('POST', ADMIN, body));
            assert.deepEqual([res.status, (await res.json()).error], [400, error], JSON.stringify(body));
        }
        const noKey = await POST(request('POST', { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2' }, { appeal_id: APPEAL, decision: 'upheld', reason: 'okay' }));
        assert.deepEqual([noKey.status, (await noKey.json()).error], [400, 'idempotency_key_invalid']);
    });
    assert.equal(calls.length, 0);
});

test('a decision goes through decide_content_appeal and emails the user once; a replay emails nobody', async () => {
    let replayed = false;
    let emails = 0;
    const calls = stubRpc((u) => {
        if (u.includes('/rpc/decide_content_appeal')) {
            return Response.json({ ok: true, replayed, appeal_id: APPEAL, status: 'upheld', action_id: 'd1', user_id: USER, appealed_action: 'takedown', standing_takedowns: 1, hold_until: '2026-10-13T00:00:00Z', unfrozen: true });
        }
        if (u.includes('/rest/v1/users')) return Response.json([{ email: 'user@example.test' }]);
        if (u.includes('api.resend.com')) { emails += 1; return Response.json({ id: 'email-1' }); }
        throw new Error(`unexpected ${u}`);
    });
    await withEnv({ ...CONFIGURED, RESEND_API_KEY: 're_test', VIOLATION_EMAIL_FROM: 'Veyrnox <support@veyrnox.test>' }, async ({ POST }) => {
        const res = await POST(request('POST', ADMIN, { appeal_id: APPEAL, decision: 'upheld', reason: '  Reviewed: own work  ' }));
        assert.equal(res.status, 201);
        assert.deepEqual(await res.json(), { appeal_id: APPEAL, status: 'upheld', action_id: 'd1', standing_takedowns: 1, hold_until: '2026-10-13T00:00:00Z', unfrozen: true, email: 'sent', replayed: false });
        replayed = true;
        const again = await POST(request('POST', ADMIN, { appeal_id: APPEAL, decision: 'upheld', reason: 'Reviewed: own work' }));
        assert.equal(again.status, 200);
        assert.deepEqual(await again.json(), { appeal_id: APPEAL, status: 'upheld', action_id: 'd1', standing_takedowns: 1, hold_until: '2026-10-13T00:00:00Z', unfrozen: true, email: 'skipped', replayed: true });
    });
    const decisions = calls.filter((c) => c.url.includes('/rpc/decide_content_appeal'));
    assert.equal(decisions.length, 2);
    assert.deepEqual(decisions[0].body, { p_auth_id: 'auth-admin', p_appeal_id: APPEAL, p_decision: 'upheld', p_reason: 'Reviewed: own work', p_idempotency_key: KEY });
    assert.equal(emails, 1, 'one email, for the new decision only');
});

test('RPC refusals map to typed errors: not_admin 403, unknown appeal 404, decided 400', async () => {
    await withEnv(CONFIGURED, async ({ GET, POST }) => {
        stubRpc(() => Response.json({ code: '42501', message: 'not_admin' }, { status: 403 }));
        for (const res of [await GET(request('GET', ADMIN)), await POST(request('POST', ADMIN, { appeal_id: APPEAL, decision: 'rejected', reason: 'okay' }))]) {
            assert.deepEqual([res.status, await res.json()], [403, { error: 'not_admin' }]);
        }
        for (const [code, status] of [['APPEAL_NOT_FOUND', 404], ['APPEAL_DECIDED', 400], ['IDEMPOTENCY_KEY_REUSED', 400]]) {
            stubRpc(() => Response.json({ ok: false, code }));
            const res = await POST(request('POST', ADMIN, { appeal_id: APPEAL, decision: 'rejected', reason: 'okay' }));
            assert.deepEqual([res.status, (await res.json()).error], [status, code.toLowerCase()]);
        }
    });
});
