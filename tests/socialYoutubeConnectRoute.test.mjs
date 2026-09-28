import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { POST } = await import('../app/api/v1/social/accounts/youtube/connect/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const challenge = 'a'.repeat(43);
function setConfigured() {
    Object.assign(process.env, {
        SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
        YOUTUBE_CLIENT_ID: '123456789012-abcdefghijklmnop.apps.googleusercontent.com', YOUTUBE_CLIENT_SECRET: 'b'.repeat(20),
        SOCIAL_OAUTH_STATE_SECRET: 'state-secret-value', PUBLIC_HOST: 'https://veyrnox.ai',
    });
}
const request = (body, headers = {}) => new Request('https://veyrnox.test/api/v1/social/accounts/youtube/connect', {
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
    for (const missing of ['YOUTUBE_CLIENT_ID', 'SOCIAL_OAUTH_STATE_SECRET', 'PUBLIC_HOST']) {
        setConfigured();
        delete process.env[missing];
        const res = await POST(request({ codeChallenge: challenge }));
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { error: 'youtube_not_configured' });
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

test('returns a Google authorize URL bound to our https per-network callback and a fresh signed state', async () => {
    setConfigured();
    const res = await POST(request({ codeChallenge: challenge }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const { authorizeUrl } = await res.json();
    const url = new URL(authorizeUrl);
    assert.equal(url.hostname, 'accounts.google.com');
    assert.equal(url.pathname, '/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/youtube');
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.readonly');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.ok(url.searchParams.get('state').includes('.'), 'state is a signed token, not a raw value');
    assert.equal(url.searchParams.get('code_challenge'), null, 'never forwarded to Google, which has no documented PKCE requirement for a web server client');
});
