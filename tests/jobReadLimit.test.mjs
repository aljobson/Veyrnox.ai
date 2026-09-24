import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
const routes = await Promise.all([
    import('../app/api/v1/jobs/route.js'),
    import('../app/api/v1/jobs/[id]/route.js'),
    import('../app/api/v1/jobs/[id]/provenance/route.js'),
]);
const id = '11111111-1111-4111-8111-111111111111';
const invoke = (route, auth = true, jobId = id) => route.GET(new Request('https://veyrnox.test/api/v1/jobs', {
    headers: auth ? { 'x-veyrnox-auth-id': 'verified-user' } : {},
}), { params: Promise.resolve({ id: jobId }) });

test('all job read routes return bounded 429 without any subsequent lookup', async () => {
    for (const route of routes) {
        for (const [value, expected] of [[15, 15], [0, 1], [600, 60], [null, 60], ['bad', 60]]) {
            let calls = 0;
            globalThis.fetch = async (_url, init) => {
                calls++;
                assert.equal(JSON.parse(init.body).p_auth_id, 'verified-user');
                return Response.json({ ok: false, code: 'RATE_LIMITED', retry_after_seconds: value });
            };
            const res = await invoke(route);
            assert.equal(res.status, 429);
            assert.equal(res.headers.get('retry-after'), String(expected));
            assert.equal(res.headers.get('cache-control'), 'no-store');
            assert.deepEqual(await res.json(), { error: 'rate_limited', retry_after_seconds: expected });
            assert.equal(calls, 1, 'especially no provenance catalog or asset lookup after denial');
        }
    }
});
test('authentication and job-id validation precede quota consumption', async () => {
    globalThis.fetch = async () => { assert.fail('unexpected database request'); };
    for (const route of routes) assert.equal((await invoke(route, false)).status, 401);
    for (const route of routes.slice(1)) assert.equal((await invoke(route, true, 'bad')).status, 400);
});
test('missing or foreign jobs still return the same 404 and offline RPCs never return data', async () => {
    globalThis.fetch = async () => Response.json({ ok: false, code: 'NOT_FOUND' });
    for (const route of routes.slice(1)) assert.equal((await invoke(route)).status, 404);
    globalThis.fetch = async () => { throw new Error('offline'); };
    for (const route of routes) assert.equal((await invoke(route)).status, 502);
});
test('pre-migration RPC responses remain compatible', async () => {
    globalThis.fetch = async () => Response.json({ ok: true, jobs: [] });
    assert.equal((await invoke(routes[0])).status, 200);
    globalThis.fetch = async () => Response.json({ ok: true, state: 'SUBMITTED', model_id: 'test', credits: 4 });
    const status = await invoke(routes[1]);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).state, 'running');
});
