import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
const route = await import('../app/api/v1/devices/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
const savedFetch = globalThis.fetch;
const savedFlag = process.env.PUSH_NOTIFICATIONS_ENABLED;
const savedErr = console.error;
let calls;
test.beforeEach(() => { calls = []; console.error = () => {}; process.env.PUSH_NOTIFICATIONS_ENABLED = 'true'; });
test.afterEach(() => {
    globalThis.fetch = savedFetch; console.error = savedErr;
    if (savedFlag === undefined) delete process.env.PUSH_NOTIFICATIONS_ENABLED; else process.env.PUSH_NOTIFICATIONS_ENABLED = savedFlag;
});

const req = (method, body, id = auth) => new Request('https://veyrnox.test/api/v1/devices', {
    method, headers: { 'content-type': 'application/json', ...(id ? { 'x-veyrnox-auth-id': id } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});
const post = (body, id) => route.POST(req('POST', body, id));
const del = (body, id) => route.DELETE(req('DELETE', body, id));
const good = { token: TOKEN, platform: 'ios' };

function stub(result = { ok: true, notify_jobs: true }, { fail } = {}) {
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push({ name, args: JSON.parse(init.body) });
        if (fail) throw new Error('backend down');
        return Response.json(result);
    };
}

test('a caller with no identity is refused before any outbound call', async () => {
    stub();
    for (const id of [null, '', 'not-a-uuid']) {
        assert.equal((await post(good, id)).status, 401);
        assert.equal((await del({ token: TOKEN }, id)).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('with the flag off (the default) both verbs answer 404 and call nothing', async () => {
    stub();
    delete process.env.PUSH_NOTIFICATIONS_ENABLED;
    assert.equal((await post(good)).status, 404);
    assert.equal((await del({ token: TOKEN })).status, 404);
    assert.deepEqual(calls, []);
});

test('input is validated at the boundary, each failure with its own typed code', async () => {
    stub();
    const bad = [
        ['not json', 'body_invalid'], ['[]', 'body_invalid'], ['null', 'body_invalid'],
        [{ platform: 'ios' }, 'token_invalid'], [{ ...good, token: 'ExponentPushToken[short]' }, 'token_invalid'],
        [{ ...good, token: `${TOKEN}; drop table users` }, 'token_invalid'], [{ ...good, token: 5 }, 'token_invalid'],
        [{ ...good, platform: 'windows' }, 'platform_invalid'], [{ token: TOKEN }, 'platform_invalid'],
        [{ ...good, device_id: 'x' }, 'device_id_invalid'], [{ ...good, device_id: 'has space in it' }, 'device_id_invalid'],
        [{ ...good, app_version: '1.0.0 beta' }, 'app_version_invalid'], [{ ...good, notify_jobs: 'no' }, 'notify_jobs_invalid'],
    ];
    for (const [body, code] of bad) {
        const res = await post(body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal((await res.json()).error, code, JSON.stringify(body));
    }
    assert.equal((await del({ token: 'nope' })).status, 400);
    assert.deepEqual(calls, []);
});

test('register passes the verified identity and the validated fields, and nothing else', async () => {
    stub({ ok: true, notify_jobs: false });
    const res = await post({ ...good, device_id: 'install-12345678', app_version: '1.2.3', notify_jobs: false, user_id: 'attacker', p_auth_id: 'attacker' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { registered: true, notify_jobs: false });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls, [{ name: 'register_push_token', args: {
        p_auth_id: auth, p_token: TOKEN, p_platform: 'ios', p_device_id: 'install-12345678', p_app_version: '1.2.3', p_notify_jobs: false,
    } }]);
});

test('the same register twice sends the same call (idempotent end to end)', async () => {
    stub();
    await post(good); await post(good);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].args.p_notify_jobs, true, 'defaults to on');
});

test('remove answers removed:true whether or not a row went, and only ever names the caller', async () => {
    stub({ ok: true });
    for (let i = 0; i < 2; i++) {
        const res = await del({ token: TOKEN });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { removed: true });
    }
    assert.deepEqual(calls[0], { name: 'remove_push_token', args: { p_auth_id: auth, p_token: TOKEN } });
});

test('database refusals map to typed errors; internals never leak', async () => {
    stub({ ok: false, error: 'rate_limited', retry_after_seconds: 600 });
    let res = await post(good);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '600');
    assert.deepEqual(await res.json(), { error: 'rate_limited', retry_after_seconds: 600 });
    stub({ ok: false, error: 'account_not_found' });
    assert.equal((await post(good)).status, 404);
    stub({ ok: false, error: 'something_internal: relation push_tokens' });
    res = await post(good);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'push_unavailable' });
    stub({}, { fail: true });
    assert.equal((await post(good)).status, 502);
    assert.equal((await del({ token: TOKEN })).status, 502);
});
