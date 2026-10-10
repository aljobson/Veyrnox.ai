// /api/v1/admin/webhooks (ADR-0083): inbound webhook health, read through
// admin_webhook_deliveries behind the same gates as the other dashboard routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/admin/webhooks/route.js', import.meta.url);
const ADMIN = { 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal2' };
const CONFIGURED = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', ADMIN_REQUIRE_AAL2: 'true' };

async function withEnv(env, run) {
    const before = {};
    for (const [k, v] of Object.entries(env)) { before[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await run(await import(`${route.href}?t=${Math.random()}`)); } finally {
        for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}
const request = (headers, query = '') => new Request(`https://veyrnox.test/api/v1/admin/webhooks${query}`, { headers });
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
    await withEnv(CONFIGURED, async ({ GET }) => {
        assert.equal((await GET(request({}))).status, 401);
        const aal1 = await GET(request({ 'x-veyrnox-auth-id': 'auth-admin', 'x-veyrnox-auth-aal': 'aal1' }));
        assert.deepEqual([aal1.status, await aal1.json()], [403, { error: 'mfa_required' }]);
    });
    await withEnv({ ...CONFIGURED, SUPABASE_URL: undefined }, async ({ GET }) => {
        assert.equal((await GET(request(ADMIN))).status, 503);
    });
    assert.equal(calls.length, 0);
});

test('the window and limit are validated, then passed to admin_webhook_deliveries; the answer is never cached', async () => {
    const calls = stubRpc((u) => {
        assert.match(u, /\/rest\/v1\/rpc\/admin_webhook_deliveries$/);
        return Response.json({ ok: true, since: '2026-10-09T00:00:00Z', hours: 24, by_source: [{ source: 'fal', total: 3 }], failures: [], stuck_events: [{ source: 'fal', external_id: 'r1' }] });
    });
    await withEnv(CONFIGURED, async ({ GET }) => {
        for (const query of ['?hours=0', '?hours=721', '?hours=1.5', '?limit=0', '?limit=201']) {
            assert.equal((await GET(request(ADMIN, query))).status, 400, query);
        }
        const res = await GET(request(ADMIN, '?hours=168&limit=20'));
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { since: '2026-10-09T00:00:00Z', hours: 24, by_source: [{ source: 'fal', total: 3 }], failures: [], stuck_events: [{ source: 'fal', external_id: 'r1' }] });
        await GET(request(ADMIN));
    });
    assert.deepEqual(calls.map((c) => c.body), [{ p_auth_id: 'auth-admin', p_hours: 168, p_limit: 20 }, { p_auth_id: 'auth-admin', p_hours: 24, p_limit: 50 }]);
});

test('not_admin is 403 and an outage is 502', async () => {
    await withEnv(CONFIGURED, async ({ GET }) => {
        stubRpc(() => Response.json({ code: '42501', message: 'not_admin' }, { status: 403 }));
        assert.deepEqual([(await GET(request(ADMIN))).status], [403]);
        stubRpc(() => { throw new Error('network'); });
        assert.deepEqual([(await GET(request(ADMIN))).status], [502]);
    });
});
