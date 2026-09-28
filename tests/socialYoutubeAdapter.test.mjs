import test from 'node:test';
import assert from 'node:assert/strict';
import {
    youtubeConfig, buildAuthorizeUrl, exchangeCodeForToken, fetchConnectedAccount, YOUTUBE_SCOPES,
} from '../packages/adapters/social/youtube.js';

const cfg = { clientId: '123456789012-abcdefghijklmnop.apps.googleusercontent.com', clientSecret: 'a'.repeat(20) };

test('youtubeConfig rejects malformed or missing env', () => {
    assert.equal(youtubeConfig({}), null);
    assert.equal(youtubeConfig({ YOUTUBE_CLIENT_ID: 'not-a-real-shape', YOUTUBE_CLIENT_SECRET: 'a'.repeat(20) }), null);
    assert.equal(youtubeConfig({ YOUTUBE_CLIENT_ID: cfg.clientId, YOUTUBE_CLIENT_SECRET: 'short' }), null);
    assert.deepEqual(youtubeConfig({ YOUTUBE_CLIENT_ID: cfg.clientId, YOUTUBE_CLIENT_SECRET: 'a'.repeat(20) }), cfg);
});

test('buildAuthorizeUrl requests offline access with forced consent, and the minimal read-only scope', () => {
    const url = new URL(buildAuthorizeUrl(cfg, {
        redirectUri: 'https://veyrnox.ai/social/connect/callback/youtube', state: 'signed-state-token',
    }));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), cfg.clientId);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/youtube');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), 'signed-state-token');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.readonly');
    assert.equal(url.searchParams.get('code_challenge'), null);
    assert.deepEqual(YOUTUBE_SCOPES, ['https://www.googleapis.com/auth/youtube.readonly'], 'read-only for a connect-only slice, not youtube.upload for a capability that does not exist yet');
});

test('buildAuthorizeUrl refuses a non-https redirect', () => {
    assert.throws(() => buildAuthorizeUrl(cfg, { redirectUri: 'http://veyrnox.ai/cb', state: 's' }));
});

test('exchangeCodeForToken posts form-urlencoded with the client secret in the body and captures the refresh token', async () => {
    let sentUrl = null, sentBody = null, sentHeaders = null;
    const fetcher = async (url, init) => {
        sentUrl = url; sentBody = init.body; sentHeaders = init.headers;
        return jsonRes({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3920, scope: YOUTUBE_SCOPES[0], token_type: 'Bearer' });
    };
    const result = await exchangeCodeForToken(cfg, { code: 'auth-code', redirectUri: 'https://veyrnox.ai/social/connect/callback/youtube' }, fetcher);
    assert.equal(result.accessToken, 'access-1');
    assert.equal(result.refreshToken, 'refresh-1');
    assert.ok(new Date(result.expiresAt).getTime() > Date.now());
    assert.equal(sentUrl, 'https://oauth2.googleapis.com/token');
    assert.equal(sentHeaders['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(sentBody);
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('code'), 'auth-code');
    assert.equal(params.get('client_id'), cfg.clientId);
    assert.equal(params.get('client_secret'), cfg.clientSecret);
    assert.equal(params.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/youtube');
});

test('exchangeCodeForToken surfaces Google\'s error rather than swallowing it', async () => {
    const fetcher = async () => jsonRes({ error: 'invalid_grant', error_description: 'Malformed auth code.' }, 400);
    await assert.rejects(
        exchangeCodeForToken(cfg, { code: 'bad', redirectUri: 'https://veyrnox.ai/cb' }, fetcher),
        /Malformed auth code/,
    );
});

test('fetchConnectedAccount resolves the caller\'s own channel', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        calls.push({ url, init });
        return jsonRes({ items: [{ id: 'UC-channel-1', snippet: { title: 'Creator Channel', thumbnails: { default: { url: 'https://example.com/a.jpg' } } } }] });
    };
    const account = await fetchConnectedAccount('user-token', fetcher);
    assert.deepEqual(account, { externalAccountId: 'UC-channel-1', displayName: 'Creator Channel', avatarUrl: 'https://example.com/a.jpg' });
    const u = new URL(calls[0].url);
    assert.equal(u.pathname, '/youtube/v3/channels');
    assert.equal(u.searchParams.get('part'), 'snippet');
    assert.equal(u.searchParams.get('mine'), 'true');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer user-token');
});

test('fetchConnectedAccount reports NO_YOUTUBE_CHANNEL as an expected conflict, not a crash', async () => {
    const fetcher = async () => jsonRes({ items: [] });
    await assert.rejects(fetchConnectedAccount('user-token', fetcher), (err) => err.code === 'NO_YOUTUBE_CHANNEL');
});

test('fetchConnectedAccount surfaces an upstream failure rather than crashing', async () => {
    const fetcher = async () => jsonRes({ error: { message: 'invalid credentials' } }, 401);
    await assert.rejects(fetchConnectedAccount('bad-token', fetcher), /invalid credentials/);
});

function jsonRes(body, status = 200) {
    return { ok: status < 400, status, json: async () => body };
}
