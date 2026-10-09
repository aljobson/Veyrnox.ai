import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { GET } = await import('../app/api/v1/social/accounts/route.js');
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
});
const auth = '11111111-1111-4111-8111-111111111111';
const brandId = '22222222-2222-4222-8222-222222222222';
const request = (headers = {}) => new Request('https://veyrnox.test/api/v1/social/accounts', {
    headers: { 'x-veyrnox-auth-id': auth, ...headers },
});
let calls;
function stub(results = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push({ name, args: JSON.parse(init.body) });
        const result = results[name] ?? ({
            consume_account_read_request: { ok: true },
            get_or_create_default_social_brand: { ok: true, idempotent: true, brand_id: brandId, label: 'My Brand', timezone: 'UTC' },
            list_social_accounts: { ok: true, accounts: [] },
        })[name];
        if (result instanceof Error) throw result;
        return Response.json(result);
    };
}

test('missing or malformed identity never reaches the database', async () => {
    stub();
    for (const identity of ['', 'bad']) {
        assert.equal((await GET(request({ 'x-veyrnox-auth-id': identity }))).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('auto-creates the caller\'s brand and lists their accounts', async () => {
    stub({ list_social_accounts: { ok: true, accounts: [{ id: 'a1', network: 'instagram', status: 'active' }] } });
    const res = await GET(request());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.brand_id, brandId);
    assert.equal(body.accounts.length, 1);
    assert.deepEqual(calls[1], { name: 'get_or_create_default_social_brand', args: { p_auth_id: auth } });
    assert.deepEqual(calls[2], { name: 'list_social_accounts', args: { p_auth_id: auth, p_brand_id: brandId } });
});

test('rate limiting stops the request before any RPC call', async () => {
    stub({ consume_account_read_request: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 45 } });
    const res = await GET(request());
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '45');
    assert.equal(calls.length, 1);
});

test('unreleased connected accounts remain visible but cannot be composed to', async () => {
    const saved = process.env.PUBLISH_RELEASED_NETWORKS;
    process.env.PUBLISH_RELEASED_NETWORKS = 'youtube';
    try {
        stub({ list_social_accounts: { ok: true, accounts: [
            { id: 'a1', network: 'instagram', status: 'active' },
            { id: 'a2', network: 'youtube', status: 'active' },
        ] } });
        const body = await (await GET(request())).json();
        assert.deepEqual(body.accounts.map(a => [a.id, a.publishingEnabled]), [['a1', false], ['a2', true]]);
    } finally {
        if (saved === undefined) delete process.env.PUBLISH_RELEASED_NETWORKS;
        else process.env.PUBLISH_RELEASED_NETWORKS = saved;
    }
});

test('a brand lookup failure never leaks upstream detail', async () => {
    stub({ get_or_create_default_social_brand: new Error('secret upstream detail') });
    const res = await GET(request());
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'internal' });
});

test('an unresolvable identity is reported as unauthenticated, not a server error', async () => {
    stub({ get_or_create_default_social_brand: { ok: false, code: 'USER_NOT_FOUND' } });
    const res = await GET(request());
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'not_authenticated' });
});

test('an account list failure never leaks upstream detail', async () => {
    stub({ list_social_accounts: new Error('secret upstream detail') });
    const res = await GET(request());
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'internal' });
});
