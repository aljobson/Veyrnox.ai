import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role',
    ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
});
const account = await import('../app/api/v1/account/route.js');
const balance = await import('../app/api/v1/balance/route.js');
const routes = [account, balance];
const auth = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const credits = { balance: 125, free_credits: 25, free_expires_at: '2026-10-24T00:00:00Z' };
const invoke = (route, identity = auth, email = 'verified@test.invalid') => route.GET(new Request('https://veyrnox.test/api/v1/account', {
    headers: { ...(identity ? { 'x-veyrnox-auth-id': identity } : {}), ...(email ? { 'x-veyrnox-auth-email': email } : {}) },
}));
let calls;
function stub({ rate = { ok: true }, fail, missing = false } = {}) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url), name = u.pathname.split('/').pop(); calls.push(name);
        if (fail === name) throw new Error('private backend failure');
        if (name === 'consume_account_read_request') {
            assert.deepEqual(JSON.parse(init.body), { p_auth_id: auth });
            return Response.json(rate);
        }
        if (name === 'read_user_credits') {
            assert.deepEqual(JSON.parse(init.body), { p_auth_id: auth });
            return Response.json(missing ? null : credits);
        }
        if (name === 'users') {
            assert.equal(u.searchParams.get('auth_id'), `eq.${auth}`);
            return Response.json(missing ? [] : [{ id: user, email: 'row@test.invalid' }]);
        }
        assert.equal(name, 'assets');
        assert.equal(u.searchParams.get('jobs.user_id'), `eq.${user}`);
        assert.match(u.searchParams.get('select'), /jobs!inner\(user_id\)/);
        return new Response('[]', { headers: { 'content-range': '0-0/42' } });
    };
}
test('both routes reject missing or malformed identity before database work', async () => {
    stub();
    for (const route of routes) for (const identity of [null, 'bad', '../forged']) {
        assert.equal((await invoke(route, identity)).status, 401);
    }
    assert.deepEqual(calls, []);
});
test('both routes deny quota before credits, user lookup or asset count', async () => {
    for (const route of routes) for (const [value, expected] of [[15, 15], [0, 1], [600, 60], [null, 60], ['bad', 60]]) {
        stub({ rate: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: value } });
        const res = await invoke(route);
        assert.equal(res.status, 429);
        assert.equal(res.headers.get('retry-after'), String(expected));
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await res.json(), { error: 'rate_limited', retry_after_seconds: expected });
        assert.deepEqual(calls, ['consume_account_read_request']);
    }
});
test('alternating account and balance requests cannot get separate buckets', async () => {
    let consumed = 0;
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        if (name === 'consume_account_read_request') {
            assert.deepEqual(JSON.parse(init.body), { p_auth_id: auth });
            return Response.json(++consumed === 1 ? { ok: true } : { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 30 });
        }
        assert.equal(consumed, 1, 'denied balance request must never read credits');
        if (name === 'read_user_credits') return Response.json(credits);
        if (name === 'users') return Response.json([]);
        assert.fail(`unexpected ${name}`);
    };
    assert.equal((await invoke(account)).status, 200);
    assert.equal((await invoke(balance)).status, 429);
});
test('broken or malformed quota fails closed without leaking details', async () => {
    for (const route of routes) {
        for (const rate of [null, {}, { ok: 'true' }, { ok: false, code: 'unknown' }]) {
            stub({ rate });
            const res = await invoke(route);
            assert.equal(res.status, 503);
            assert.equal(res.headers.get('cache-control'), 'no-store');
            assert.deepEqual(await res.json(), { error: 'rate_limit_unavailable' });
            assert.deepEqual(calls, ['consume_account_read_request']);
        }
        stub({ fail: 'consume_account_read_request' });
        assert.equal((await invoke(route)).status, 503);
        assert.deepEqual(calls, ['consume_account_read_request']);
    }
});
test('allowed reads preserve balances, expiry, identity and owner-scoped asset counts', async () => {
    stub();
    const summary = await invoke(account);
    assert.equal(summary.status, 200);
    assert.equal(summary.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await summary.json(), { email: 'verified@test.invalid', credits: 125, assets: 42 });
    assert.deepEqual(calls, ['consume_account_read_request', 'read_user_credits', 'users', 'assets']);
    stub();
    const res = await invoke(balance);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), credits);
    assert.deepEqual(calls, ['consume_account_read_request', 'read_user_credits']);
    stub();
    assert.equal((await (await invoke(account, auth, null)).json()).email, 'row@test.invalid');
});
test('unknown accounts retain zero responses with no downstream queries', async () => {
    for (const [route, expected] of [[account, { email: 'verified@test.invalid', credits: 0, assets: null }],
        [balance, { balance: 0, free_credits: 0, free_expires_at: null }]]) {
        stub({ rate: { ok: false, code: 'NOT_FOUND' } });
        const res = await invoke(route);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), expected);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(calls, ['consume_account_read_request']);
    }
});
test('asset count failure still preserves credits and credit failures stay typed 502', async () => {
    stub({ fail: 'assets' });
    const res = await invoke(account);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { email: 'verified@test.invalid', credits: 125, assets: null });
    for (const route of routes) {
        stub({ fail: 'read_user_credits' });
        const failed = await invoke(route);
        assert.equal(failed.status, 502);
        assert.deepEqual(await failed.json(), { error: 'internal' });
        assert.ok(!calls.includes('assets'));
    }
});
test('disabled rollout retains pre-migration behavior including unprovisioned accounts', async () => {
    process.env.ACCOUNT_READ_RATE_LIMIT_ENABLED = 'false';
    try {
        for (const route of routes) for (const missing of [false, true]) {
            stub({ fail: 'consume_account_read_request', missing });
            assert.equal((await invoke(route)).status, 200);
            assert.ok(!calls.includes('consume_account_read_request'));
        }
    } finally { process.env.ACCOUNT_READ_RATE_LIMIT_ENABLED = 'true'; }
});
