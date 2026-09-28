import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { POST } = await import('../app/api/v1/social/accounts/instagram/connect/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const challenge = 'a'.repeat(43);
function setConfigured() {
    Object.assign(process.env, {
        SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
        META_APP_ID: '123456789012345', META_APP_SECRET: 'b'.repeat(32),
        SOCIAL_OAUTH_STATE_SECRET: 'state-secret-value', PUBLIC_HOST: 'https://veyrnox.ai',
    });
}
const request = (body, headers = {}) => new Request('https://veyrnox.test/api/v1/social/accounts/instagram/connect', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': auth, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
});

test('missing or malformed identity is rejected before anything else', async () => {
    setConfigured();
    for (const identity of ['', 'bad']) {
        assert.equal((await POST(request({ codeChallenge: challenge }, { 'x-veyrnox-auth-id': identity }))).status, 401);
    }
});

test('each required config var missing degrades to a clean 503', async () => {
    for (const missing of ['META_APP_ID', 'SOCIAL_OAUTH_STATE_SECRET', 'PUBLIC_HOST']) {
        setConfigured();
        delete process.env[missing];
        const res = await POST(request({ codeChallenge: challenge }));
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { error: 'instagram_not_configured' });
    }
    setConfigured();
});

test('a non-https PUBLIC_HOST is refused, not silently downgraded', async () => {
    setConfigured();
    process.env.PUBLIC_HOST = 'http://veyrnox.ai';
    assert.equal((await POST(request({ codeChallenge: challenge }))).status, 503);
    setConfigured();
});

test('a missing or malformed code challenge is rejected', async () => {
    setConfigured();
    for (const bad of [undefined, '', 'too-short', 123]) {
        assert.equal((await POST(request({ codeChallenge: bad }))).status, 400);
    }
});

test('returns a Meta authorize URL bound to our https callback and a fresh signed state', async () => {
    setConfigured();
    const res = await POST(request({ codeChallenge: challenge }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const { authorizeUrl } = await res.json();
    const url = new URL(authorizeUrl);
    assert.equal(url.hostname, 'www.facebook.com');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback');
    assert.equal(url.searchParams.get('code_challenge'), challenge);
    assert.ok(url.searchParams.get('state').includes('.'), 'state is a signed token, not a raw value');
});
