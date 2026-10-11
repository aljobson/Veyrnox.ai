// /api/v1/admin/reports (ADR-0083): the user report queue and evidence
// release. Same gates as the other dashboard routes; a resolve and a release
// are distinct bodies on the same POST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/admin/reports/route.js', import.meta.url);
const REPORT = '55555555-5555-4555-8555-555555555555';
const ACTION = '66666666-6666-4666-8666-666666666666';
const ADMIN = { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2' };
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true' };

async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${route.href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
const request = (method, headers, body, query = '') => new Request(`https://veyrnox.test/api/v1/admin/reports${query}`, {
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
        assert.equal((await POST(request('POST', {}, { report_id: REPORT, resolution: 'done' }))).status, 401);
        const aal1 = await GET(request('GET', { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal1' }));
        assert.deepEqual([aal1.status, await aal1.json()], [403, { error: 'mfa_required' }]);
    });
    await withEnv({ ...CONFIGURED, SUPABASE_URL: undefined }, async ({ GET }) => {
        assert.equal((await GET(request('GET', ADMIN))).status, 503);
    });
    assert.equal(calls.length, 0);
});

test('GET lists open reports by default and passes the status filter', async () => {
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/list_content_reports$/);
        return Response.json({ ok: true, reports: [{ id: REPORT, category: 'csam' }] });
    });
    await withEnv(CONFIGURED, async ({ GET }) => {
        const res = await GET(request('GET', ADMIN));
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { reports: [{ id: REPORT, category: 'csam' }], unavailable_scans_24h: 0, asset_gone_scans_24h: 0 });
        await GET(request('GET', ADMIN, undefined, '?status=all&limit=10'));
        const bad = await GET(request('GET', ADMIN, undefined, '?status=closed'));
        assert.deepEqual([bad.status, (await bad.json()).error], [400, 'status_invalid']);
    });
    assert.deepEqual(calls.map((c) => [c.body.p_status, c.body.p_limit]), [['open', 50], [null, 10]]);
});

test('a resolve validates its body and goes through resolve_content_report', async () => {
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/resolve_content_report$/);
        return Response.json({ ok: true, report_id: REPORT, replayed: false });
    });
    await withEnv(CONFIGURED, async ({ POST }) => {
        for (const [body, error] of [[{ resolution: 'done' }, 'report_id_invalid'], [{ report_id: REPORT, resolution: 'x' }, 'resolution_invalid'], [[1], 'body_invalid']]) {
            const res = await POST(request('POST', ADMIN, body));
            assert.deepEqual([res.status, (await res.json()).error], [400, error], JSON.stringify(body));
        }
        const res = await POST(request('POST', ADMIN, { report_id: REPORT, resolution: '  Escalated and frozen  ' }));
        assert.deepEqual([res.status, await res.json()], [201, { report_id: REPORT, replayed: false }]);
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { p_auth_id: 'auth-admin', p_report_id: REPORT, p_resolution: 'Escalated and frozen' });
});

test('a release names the escalation and a reason and goes through release_evidence_hold', async () => {
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/release_evidence_hold$/);
        return Response.json({ ok: true, released: 2, action_id: 'r1', replayed: false });
    });
    await withEnv(CONFIGURED, async ({ POST }) => {
        for (const [body, error] of [[{ release_action_id: 'nope', reason: 'retention over' }, 'release_action_id_invalid'], [{ release_action_id: ACTION, reason: 'x' }, 'reason_invalid']]) {
            const res = await POST(request('POST', ADMIN, body));
            assert.deepEqual([res.status, (await res.json()).error], [400, error], JSON.stringify(body));
        }
        const res = await POST(request('POST', ADMIN, { release_action_id: ACTION, reason: 'Report acknowledged, retention over' }));
        assert.deepEqual([res.status, await res.json()], [201, { released: 2, action_id: 'r1', replayed: false }]);
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { p_auth_id: 'auth-admin', p_action_id: ACTION, p_reason: 'Report acknowledged, retention over' });
});

test('RPC refusals map to typed errors: not_admin 403, unknown report or action 404', async () => {
    await withEnv(CONFIGURED, async ({ GET, POST }) => {
        stubRpc(() => Response.json({ code: '42501', message: 'not_admin' }, { status: 403 }));
        for (const res of [await GET(request('GET', ADMIN)), await POST(request('POST', ADMIN, { report_id: REPORT, resolution: 'done' }))]) {
            assert.deepEqual([res.status, await res.json()], [403, { error: 'not_admin' }]);
        }
        stubRpc(() => Response.json({ ok: false, code: 'REPORT_NOT_FOUND' }));
        assert.equal((await POST(request('POST', ADMIN, { report_id: REPORT, resolution: 'done' }))).status, 404);
        stubRpc(() => Response.json({ ok: false, code: 'ACTION_NOT_FOUND' }));
        assert.equal((await POST(request('POST', ADMIN, { release_action_id: ACTION, reason: 'retention over' }))).status, 404);
    });
});

test('unavailable and already-gone counts survive an empty report queue', async () => {
    stubRpc(() => Response.json({ ok: true, reports: [], unavailable_scans_24h: 31, asset_gone_scans_24h: 7 }));
    await withEnv(CONFIGURED, async ({ GET }) => {
        assert.deepEqual(await (await GET(request('GET', ADMIN))).json(), { reports: [], unavailable_scans_24h: 31, asset_gone_scans_24h: 7 });
    });
});
test('scanner release and disarm validate reason and identity and call the intended RPC', async () => {
    await withEnv(CONFIGURED, async ({ POST }) => {
        for (const [body, name, args] of [
            [{ release_job_id: REPORT, reason: ' reviewed ' }, 'release_content_hold', { p_job_id: REPORT }],
            [{ scanner_disarm: true, reason: ' reviewed ' }, 'disarm_content_scan_monitor', {}],
        ]) {
            const calls = stubRpc((url, data) => {
                assert.ok(url.endsWith('/' + name));
                assert.deepEqual(data, { p_auth_id: 'auth-admin', p_reason: 'reviewed', ...args });
                return Response.json({ ok: true, replayed: true });
            });
            assert.equal((await POST(request('POST', {}, body))).status, 401);
            assert.equal((await POST(request('POST', ADMIN, { ...body, reason: 'x' }))).status, 400);
            const res = await POST(request('POST', ADMIN, body));
            assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(res.status, 200); assert.equal(calls.length, 1);
        }
        assert.equal((await POST(request('POST', ADMIN, { release_job_id: 'bad', reason: 'reviewed' }))).status, 400);
        assert.equal((await POST(request('POST', ADMIN, { scanner_disarm: false, reason: 'reviewed' }))).status, 400);
    });
});
