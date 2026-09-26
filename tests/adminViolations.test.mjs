// /api/v1/admin/violations (ADR-0058 decision 7): the content violation record.
// Same three gates as /api/v1/admin/metrics, strict input shapes, and every
// write goes through record_content_violation with the caller's auth id so the
// RPC can check users.is_admin itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/admin/violations/route.js', import.meta.url);
const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const ADMIN = { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2' };

async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${route.href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true' };
const request = (method, headers, body, query = '') => new Request(`https://veyrnox.test/api/v1/admin/violations${query}`, {
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

test('unauthenticated, aal1 and unconfigured callers are refused before any RPC', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ GET, POST }) => {
        assert.equal((await GET(request('GET', {}))).status, 401);
        assert.equal((await POST(request('POST', {}, { user_id: USER, tier: 'warning', reason: 'x' }))).status, 401);
        const aal1 = await GET(request('GET', { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal1' }));
        assert.deepEqual([aal1.status, await aal1.json()], [403, { error: 'mfa_required' }]);
    });
    await withEnv({ ...CONFIGURED, SUPABASE_URL: undefined }, async ({ GET }) => {
        assert.equal((await GET(request('GET', ADMIN))).status, 503);
    });
    assert.equal(calls.length, 0);
});

test('POST validates the body shape before calling the RPC', async () => {
    const calls = stubRpc(() => { throw new Error('must not reach Supabase'); });
    await withEnv(CONFIGURED, async ({ POST }) => {
        for (const [body, error] of [
            [{ tier: 'warning', reason: 'r' }, 'user_id_invalid'],
            [{ user_id: 'not-a-uuid', tier: 'warning', reason: 'r' }, 'user_id_invalid'],
            [{ user_id: USER, job_id: 'nope', tier: 'warning', reason: 'r' }, 'job_id_invalid'],
            [{ user_id: USER, tier: 'ban', reason: 'r' }, 'tier_invalid'],
            [{ user_id: USER, tier: 'warning', reason: '   ' }, 'reason_invalid'],
            [{ user_id: USER, tier: 'warning', reason: 'x'.repeat(501) }, 'reason_invalid'],
            [{ user_id: USER, tier: 'takedown', reason: 'r' }, 'job_id_required'],
            [[1, 2], 'body_invalid'],
        ]) {
            const res = await POST(request('POST', ADMIN, body));
            assert.deepEqual([res.status, (await res.json()).error], [400, error], JSON.stringify(body));
        }
        const bad = await POST(new Request('https://veyrnox.test/api/v1/admin/violations', { method: 'POST', headers: ADMIN, body: '{not json' }));
        assert.equal(bad.status, 400);
    });
    assert.equal(calls.length, 0);
});

test('a takedown is recorded through the RPC with the admin auth id and reported back', async () => {
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/record_content_violation$/);
        return Response.json({ ok: true, action_id: '33333333-3333-4333-8333-333333333333', tier: 'takedown', assets_removed: 1, takedowns: 3, frozen: true });
    });
    await withEnv(CONFIGURED, async ({ POST }) => {
        const res = await POST(request('POST', ADMIN, { user_id: USER, job_id: JOB, tier: 'takedown', reason: '  Real person without consent  ' }));
        assert.equal(res.status, 201);
        assert.deepEqual(await res.json(), { action_id: '33333333-3333-4333-8333-333333333333', tier: 'takedown', assets_removed: 1, takedowns: 3, frozen: true });
        assert.equal(res.headers.get('cache-control'), 'no-store');
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { p_auth_id: 'auth-admin', p_user_id: USER, p_job_id: JOB, p_tier: 'takedown', p_reason: 'Real person without consent' });
});

test('RPC refusals map to typed errors: not_admin is 403, unknown user or job 404, others 400', async () => {
    await withEnv(CONFIGURED, async ({ POST, GET }) => {
        stubRpc(() => Response.json({ code: '42501', message: 'not_admin' }, { status: 403 }));
        for (const res of [await POST(request('POST', ADMIN, { user_id: USER, tier: 'warning', reason: 'r' })), await GET(request('GET', ADMIN))]) {
            assert.deepEqual([res.status, await res.json()], [403, { error: 'not_admin' }]);
        }
        for (const [code, status] of [['USER_NOT_FOUND', 404], ['JOB_NOT_FOUND', 404], ['JOB_NOT_OWNED', 400], ['TIER_INVALID', 400]]) {
            stubRpc(() => Response.json({ ok: false, code }));
            const res = await POST(request('POST', ADMIN, { user_id: USER, job_id: JOB, tier: 'takedown', reason: 'r' }));
            assert.deepEqual([res.status, (await res.json()).error], [status, code.toLowerCase()]);
        }
    });
});

test('GET lists through list_content_violations with a validated user filter and limit', async () => {
    const rows = [{ id: 'a', user_id: USER, email: 'x@example.test', action: 'takedown', actor: 'admin@example.test', reason: 'r', job_id: JOB, model_id: 'seedance-2.0-fast', created_at: '2026-09-26T12:00:00Z' }];
    const calls = stubRpc((u) => { assert.match(u, /\/rpc\/list_content_violations$/); return Response.json(rows); });
    await withEnv(CONFIGURED, async ({ GET }) => {
        const res = await GET(request('GET', ADMIN, undefined, `?user_id=${USER}&limit=10`));
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { violations: rows });
        assert.deepEqual(calls[0].body, { p_auth_id: 'auth-admin', p_user_id: USER, p_limit: 10 });
        for (const [query, error] of [['?user_id=nope', 'user_id_invalid'], ['?limit=0', 'limit_invalid'], ['?limit=201', 'limit_invalid'], ['?limit=abc', 'limit_invalid']]) {
            const bad = await GET(request('GET', ADMIN, undefined, query));
            assert.deepEqual([bad.status, (await bad.json()).error], [400, error], query);
        }
        assert.equal(calls.length, 1, 'invalid filters never reach the RPC');
    });
});
