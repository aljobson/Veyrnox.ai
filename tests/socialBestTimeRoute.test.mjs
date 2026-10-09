import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c);}`));
const { GET } = await import('../app/api/v1/social/best-time/route.js');
const auth = '11111111-1111-4111-8111-111111111111';
const account = '33333333-3333-4333-8333-333333333333';
const request = (id = account, identity = auth) => new Request(`https://veyrnox.test/api/v1/social/best-time?accountId=${id}`, { headers: { 'x-veyrnox-auth-id': identity } });
let calls;
function stub(result = { ok: true, insights: null }, limit = { ok: true }) {
    Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', PUBLISH_POSTING_INSIGHTS_ENABLED: 'true', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true' });
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop(); calls.push({ name, args: JSON.parse(init.body) });
        if (name === 'consume_account_read_request') return Response.json(limit);
        if (result instanceof Error) throw result;
        return Response.json(result);
    };
}

test('rejects identity, disabled rollout and invalid account before any RPC', async () => {
    stub(); assert.equal((await GET(request(account, 'bad'))).status, 401);
    delete process.env.PUBLISH_POSTING_INSIGHTS_ENABLED;
    assert.equal((await GET(request())).status, 503);
    process.env.PUBLISH_POSTING_INSIGHTS_ENABLED = 'true';
    assert.equal((await GET(request('bad'))).status, 400);
    assert.deepEqual(calls, []);
});

test('read is owner-bound, uncached, and missing aggregates remain null', async () => {
    stub(); const res = await GET(request());
    assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { insights: null });
    assert.deepEqual(calls[1], { name: 'get_social_posting_insights', args: { p_auth_id: auth, p_account_id: account } });
});

test('maps denied reads and DB failures to typed errors without leaking vendor detail', async () => {
    for (const [result, code] of [[{ ok: false, code: 'ACCOUNT_NOT_FOUND' }, 404], [{ ok: false, code: 'USER_NOT_FOUND' }, 401], [new Error('private SQL details'), 502]]) {
        stub(result); const res = await GET(request()); assert.equal(res.status, code);
        assert.ok(!(await res.text()).includes('private SQL'));
    }
});

test('rate limiting prevents the aggregate read', async () => {
    stub(undefined, { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 10 });
    assert.equal((await GET(request())).status, 429);
    assert.deepEqual(calls.map((c) => c.name), ['consume_account_read_request']);
});
