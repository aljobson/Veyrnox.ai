import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SessionError,
    assessBalance,
    assessSessionMe,
    openSession,
    readConfig,
    runAuthedSmoke,
} from '../scripts/check-authed-smoke.mjs';

const UUID = '3f2b1c4e-5a6d-4e7f-8a9b-0c1d2e3f4a5b';
const config = {
    supabaseUrl: 'https://auth.example',
    anonKey: 'anon-key',
    serviceRoleKey: 'service-key',
    email: 'smoke@example.com',
    baseUrl: 'https://site.example',
};

function reply(status, body) {
    return { status, json: async () => body };
}

// A fake network: routes by URL, records every call.
function fakeFetch(routes) {
    const calls = [];
    const impl = async (url, options = {}) => {
        const href = String(url);
        calls.push({ href, options });
        const key = Object.keys(routes).find(k => href.includes(k));
        if (!key) throw new Error(`unexpected request to ${href}`);
        const handler = routes[key];
        return typeof handler === 'function' ? handler(options) : handler;
    };
    return { impl, calls };
}

const healthyRoutes = () => ({
    '/auth/v1/admin/generate_link': reply(200, { hashed_token: 'hash' }),
    '/auth/v1/verify': reply(200, { access_token: 'access' }),
    '/auth/v1/logout': reply(204, null),
    '/api/v1/session/me': reply(200, { authId: UUID, email: 'Smoke@Example.com', role: 'authenticated' }),
    '/api/v1/balance': reply(200, { balance: 0, free_credits: 0, free_expires_at: null }),
});

test('a healthy deploy passes both signed-in checks and revokes the session', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes());
    const result = await runAuthedSmoke(config, impl);
    assert.equal(result.ok, true);
    assert.ok(calls.some(c => c.href.includes('/auth/v1/logout')));
});

test('the service-role key reaches Supabase Auth only, never the site', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes());
    await runAuthedSmoke(config, impl);
    for (const call of calls) {
        const sent = JSON.stringify(call.options.headers ?? {}) + String(call.options.body ?? '');
        if (call.href.startsWith(config.baseUrl)) {
            assert.ok(!sent.includes('service-key'), `service key sent to ${call.href}`);
            assert.ok(sent.includes('access'), 'site requests carry the user session');
        }
        if (call.href.includes('/auth/v1/verify') || call.href.includes('/auth/v1/logout')) {
            assert.ok(!sent.includes('service-key'), `service key sent to ${call.href}`);
        }
    }
});

test('only read-only requests are made to the site', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes());
    await runAuthedSmoke(config, impl);
    for (const call of calls.filter(c => c.href.startsWith(config.baseUrl))) {
        assert.ok(!call.options.method || call.options.method === 'GET', `${call.href} is not a GET`);
    }
});

test('a gateway that rejects the session fails the check, and the session is still revoked', async () => {
    const routes = { ...healthyRoutes(), '/api/v1/session/me': reply(401, { error: 'unauthorized' }) };
    const { impl, calls } = fakeFetch(routes);
    const result = await runAuthedSmoke(config, impl);
    assert.equal(result.ok, false);
    assert.match(result.results[0].problems.join(), /status 401/);
    assert.ok(calls.some(c => c.href.includes('/auth/v1/logout')));
});

test('a balance read that breaks is reported', async () => {
    const routes = { ...healthyRoutes(), '/api/v1/balance': reply(502, { error: 'internal' }) };
    const { impl } = fakeFetch(routes);
    const result = await runAuthedSmoke(config, impl);
    assert.equal(result.ok, false);
    assert.match(result.results[1].problems.join(), /status 502/);
});

test('an identity for a different account is a failure', () => {
    assert.match(assessSessionMe(200, { authId: UUID, email: 'other@example.com' }, 'smoke@example.com').join(), /email does not match/);
    assert.match(assessSessionMe(200, { authId: 'nope', email: 'smoke@example.com' }, 'smoke@example.com').join(), /not a UUID/);
});

test('balance figures must be non-negative numbers', () => {
    assert.deepEqual(assessBalance(200, { balance: 12, free_credits: 0 }), []);
    assert.match(assessBalance(200, { balance: '12', free_credits: 0 }).join(), /balance is not/);
    assert.match(assessBalance(200, { balance: -1, free_credits: 0 }).join(), /balance is not/);
});

test('no session means a SessionError, not a failed check', async () => {
    const noUser = fakeFetch({ ...healthyRoutes(), '/auth/v1/admin/generate_link': reply(404, { msg: 'User not found' }) });
    await assert.rejects(openSession(config, noUser.impl), SessionError);
    const badVerify = fakeFetch({ ...healthyRoutes(), '/auth/v1/verify': reply(403, { msg: 'expired' }) });
    await assert.rejects(openSession(config, badVerify.impl), SessionError);
});

test('the token hash is found at either place Supabase puts it', async () => {
    const nested = fakeFetch({ ...healthyRoutes(), '/auth/v1/admin/generate_link': reply(200, { properties: { hashed_token: 'hash' } }) });
    assert.equal(await openSession(config, nested.impl), 'access');
});

test('readConfig names every missing variable and never the values', () => {
    assert.throws(() => readConfig({ SUPABASE_URL: 'https://x' }), /SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SMOKE_USER_EMAIL/);
    const ok = readConfig({
        SUPABASE_URL: 'https://x/', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', SMOKE_USER_EMAIL: 'e@x',
    });
    assert.equal(ok.supabaseUrl, 'https://x');
    assert.equal(ok.baseUrl, 'https://veyrnox.ai');
});
