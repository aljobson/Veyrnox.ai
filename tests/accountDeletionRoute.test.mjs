import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
const prepareRoute = await import('../app/api/v1/account/deletion/route.js');
const accountRoute = await import('../app/api/v1/account/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'ab'.repeat(32);
const savedFetch = globalThis.fetch;
const savedFlag = process.env.ACCOUNT_DELETION_ENABLED;
const savedErr = console.error;
let calls;
test.beforeEach(() => { calls = []; console.error = () => {}; process.env.ACCOUNT_DELETION_ENABLED = 'true'; });
test.afterEach(() => {
    globalThis.fetch = savedFetch; console.error = savedErr;
    if (savedFlag === undefined) delete process.env.ACCOUNT_DELETION_ENABLED; else process.env.ACCOUNT_DELETION_ENABLED = savedFlag;
});

const post = (id = auth) => prepareRoute.POST(new Request('https://veyrnox.test/api/v1/account/deletion', {
    method: 'POST', headers: id ? { 'x-veyrnox-auth-id': id } : {},
}));
const del = (body, id = auth) => accountRoute.DELETE(new Request('https://veyrnox.test/api/v1/account', {
    method: 'DELETE', headers: { 'content-type': 'application/json', ...(id ? { 'x-veyrnox-auth-id': id } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
}));
// rpcs: name -> result; authDelete: status of the Supabase Auth admin call
function stub({ rpcs = {}, authDelete = 200, fail } = {}) {
    globalThis.fetch = async (url, init) => {
        const u = new URL(url);
        if (u.pathname.startsWith('/auth/v1/admin/users/')) {
            calls.push(`auth:${init.method}:${decodeURIComponent(u.pathname.split('/').pop())}`);
            assert.equal(init.headers.Authorization, 'Bearer test-role');
            assert.deepEqual(JSON.parse(init.body), { should_soft_delete: false });
            return new Response(null, { status: authDelete });
        }
        const name = u.pathname.split('/').pop();
        calls.push(name);
        if (fail === name) throw new Error('backend down');
        assert.equal(JSON.parse(init.body).p_auth_id, auth);
        return Response.json(rpcs[name] ?? { ok: true });
    };
}

test('both routes refuse a caller with no identity before any outbound call', async () => {
    stub();
    for (const id of [null, '', 'not-a-uuid']) {
        assert.equal((await post(id)).status, 401);
        assert.equal((await del({ confirmation_token: TOKEN }, id)).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('with the flag off (the default) both routes answer 404 and call nothing', async () => {
    stub();
    delete process.env.ACCOUNT_DELETION_ENABLED;
    assert.equal((await post()).status, 404);
    assert.equal((await del({ confirmation_token: TOKEN })).status, 404);
    process.env.ACCOUNT_DELETION_ENABLED = 'false';
    assert.equal((await post()).status, 404);
    assert.deepEqual(calls, []);
});

test('preview returns what would be forfeited and a token, never the raw rpc envelope', async () => {
    const body = { ok: true, eligible: true, blockers: [], forfeit: { credits: 40, free_credits: 10 }, confirmation_token: TOKEN, expires_at: '2026-10-18T10:00:00Z' };
    stub({ rpcs: { prepare_account_deletion: body } });
    const res = await post();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { eligible: true, blockers: [], forfeit: { credits: 40, free_credits: 10 }, confirmation_token: TOKEN, expires_at: '2026-10-18T10:00:00Z' });
});

test('preview of a blocked account carries the reasons and no token', async () => {
    stub({ rpcs: { prepare_account_deletion: { ok: true, eligible: false, blockers: ['account_frozen'], forfeit: { credits: 5, free_credits: 0 } } } });
    const body = await (await post()).json();
    assert.equal(body.eligible, false);
    assert.deepEqual(body.blockers, ['account_frozen']);
    assert.equal(body.confirmation_token, undefined);
});

test('preview errors are typed', async () => {
    stub({ rpcs: { prepare_account_deletion: { ok: false, error: 'rate_limited', retry_after_seconds: 3600 } } });
    const limited = await post();
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '3600');
    assert.deepEqual(await limited.json(), { error: 'rate_limited', retry_after_seconds: 3600 });
    stub({ rpcs: { prepare_account_deletion: { ok: false, error: 'account_not_found' } } });
    assert.equal((await post()).status, 404);
    stub({ fail: 'prepare_account_deletion' });
    const down = await post();
    assert.equal(down.status, 502);
    assert.deepEqual(await down.json(), { error: 'deletion_unavailable' });
});

test('DELETE validates the body before touching anything', async () => {
    stub();
    assert.equal((await del('{nope')).status, 400);
    for (const body of [{}, { confirmation_token: 'short' }, { confirmation_token: 7 }, { confirmation_token: TOKEN.toUpperCase() }, null]) {
        const res = await del(body);
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'confirmation_invalid' });
    }
    assert.deepEqual(calls, []);
});

test('DELETE erases the data, removes the Auth user, then records it', async () => {
    stub({ rpcs: { erase_account: { ok: true, replayed: false, state: 'erased', forfeited_credits: 40 } } });
    const res = await del({ confirmation_token: TOKEN });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: true, replayed: false, forfeited_credits: 40 });
    assert.deepEqual(calls, ['erase_account', `auth:DELETE:${auth}`, 'complete_account_deletion']);
});

test('a replay after completion answers 200 and does not touch Auth again', async () => {
    stub({ rpcs: { erase_account: { ok: true, replayed: true, state: 'completed' } } });
    const res = await del({ confirmation_token: TOKEN });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: true, replayed: true });
    assert.deepEqual(calls, ['erase_account']);
});

test('a replay after the data was erased but Auth removal failed finishes the job', async () => {
    stub({ rpcs: { erase_account: { ok: true, replayed: true, state: 'erased' } } });
    const res = await del({ confirmation_token: TOKEN });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: true, replayed: true });
    assert.deepEqual(calls, ['erase_account', `auth:DELETE:${auth}`, 'complete_account_deletion']);
});

test('an Auth user that is already gone (404) counts as deleted', async () => {
    stub({ rpcs: { erase_account: { ok: true, replayed: false, state: 'erased', forfeited_credits: 0 } }, authDelete: 404 });
    assert.equal((await del({ confirmation_token: TOKEN })).status, 200);
});

test('when Auth removal fails the answer is 502 deletion_incomplete and the record is not completed', async () => {
    stub({ rpcs: { erase_account: { ok: true, replayed: false, state: 'erased', forfeited_credits: 1 } }, authDelete: 500 });
    const res = await del({ confirmation_token: TOKEN });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'deletion_incomplete' });
    assert.deepEqual(calls, ['erase_account', `auth:DELETE:${auth}`]);
});

test('a blocked account is a 409 with the reasons, and Auth is never called', async () => {
    stub({ rpcs: { erase_account: { ok: false, error: 'deletion_blocked', blockers: ['account_frozen'] } } });
    const res = await del({ confirmation_token: TOKEN });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'deletion_blocked', blockers: ['account_frozen'] });
    assert.deepEqual(calls, ['erase_account']);
});

test('a wrong or expired token is a 400 with a stable code', async () => {
    for (const error of ['confirmation_invalid', 'confirmation_expired']) {
        stub({ rpcs: { erase_account: { ok: false, error } } });
        const res = await del({ confirmation_token: TOKEN });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error });
    }
});

test('a database failure leaks nothing and does not reach Auth', async () => {
    stub({ fail: 'erase_account' });
    const res = await del({ confirmation_token: TOKEN });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'deletion_unavailable' });
    assert.equal(calls.some((c) => c.startsWith('auth:')), false);
});
