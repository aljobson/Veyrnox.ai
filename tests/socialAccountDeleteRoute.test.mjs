import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { DELETE } = await import('../app/api/v1/social/accounts/[accountId]/route.js');
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only' });

const auth = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const request = (headers = {}) => new Request(`https://veyrnox.test/api/v1/social/accounts/${accountId}`, {
    method: 'DELETE', headers: { 'x-veyrnox-auth-id': auth, ...headers },
});
let calls;
function stub(result = { ok: true }) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push({ name, args: JSON.parse(init.body) });
        if (result instanceof Error) throw result;
        return Response.json(result);
    };
}

test('missing or malformed identity never reaches the database', async () => {
    stub();
    for (const identity of ['', 'bad']) {
        assert.equal((await DELETE(request({ 'x-veyrnox-auth-id': identity }), { params: Promise.resolve({ accountId }) })).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('a malformed account id is rejected before any RPC call', async () => {
    stub();
    const res = await DELETE(request(), { params: Promise.resolve({ accountId: 'not-a-uuid' }) });
    assert.equal(res.status, 400);
    assert.deepEqual(calls, []);
});

test('disconnects the caller\'s own account', async () => {
    stub({ ok: true });
    const res = await DELETE(request(), { params: Promise.resolve({ accountId }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(calls[0], { name: 'disconnect_social_account', args: { p_auth_id: auth, p_account_id: accountId } });
});

test('an account that is not the caller\'s (or does not exist) is reported as not found', async () => {
    stub({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
    const res = await DELETE(request(), { params: Promise.resolve({ accountId }) });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
});

test('an RPC failure never leaks upstream detail', async () => {
    stub(new Error('secret upstream detail'));
    const res = await DELETE(request(), { params: Promise.resolve({ accountId }) });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'internal' });
});
