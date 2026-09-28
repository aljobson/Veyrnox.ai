import test from 'node:test';
import assert from 'node:assert/strict';
import {
    tiktokConfig, buildAuthorizeUrl, exchangeCodeForToken, fetchConnectedAccount, TIKTOK_SCOPES,
} from '../packages/adapters/social/tiktok.js';

const cfg = { clientKey: 'testclientkey123', clientSecret: 'a'.repeat(20) };

test('tiktokConfig rejects malformed or missing env', () => {
    assert.equal(tiktokConfig({}), null);
    assert.equal(tiktokConfig({ TIKTOK_CLIENT_KEY: 'has spaces', TIKTOK_CLIENT_SECRET: 'a'.repeat(20) }), null);
    assert.equal(tiktokConfig({ TIKTOK_CLIENT_KEY: 'testclientkey123', TIKTOK_CLIENT_SECRET: 'short' }), null);
    assert.deepEqual(tiktokConfig({ TIKTOK_CLIENT_KEY: 'testclientkey123', TIKTOK_CLIENT_SECRET: 'a'.repeat(20) }), cfg);
});

test('buildAuthorizeUrl uses client_key and a comma-separated scope (TikTok\'s own convention), with no PKCE params it does not document', () => {
    const url = new URL(buildAuthorizeUrl(cfg, {
        redirectUri: 'https://veyrnox.ai/social/connect/callback/tiktok', state: 'signed-state-token',
    }));
    assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
    assert.equal(url.searchParams.get('client_key'), cfg.clientKey);
    assert.equal(url.searchParams.get('client_id'), null, 'TikTok\'s own term is client_key, not client_id');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/tiktok');
    assert.equal(url.searchParams.get('state'), 'signed-state-token');
    assert.equal(url.searchParams.get('scope'), 'user.info.basic');
    assert.equal(url.searchParams.get('code_challenge'), null);
    assert.deepEqual(TIKTOK_SCOPES, ['user.info.basic'], 'minimal scope for a connect-only slice, not video.publish for a capability that does not exist yet');
});

test('buildAuthorizeUrl refuses a non-https redirect', () => {
    assert.throws(() => buildAuthorizeUrl(cfg, { redirectUri: 'http://veyrnox.ai/cb', state: 's' }));
});

test('exchangeCodeForToken posts form-urlencoded with client_key/client_secret in the body and captures the refresh token', async () => {
    let sentUrl = null, sentBody = null, sentHeaders = null;
    const fetcher = async (url, init) => {
        sentUrl = url; sentBody = init.body; sentHeaders = init.headers;
        return jsonRes({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86400, open_id: 'open-1', scope: 'user.info.basic', token_type: 'Bearer' });
    };
    const result = await exchangeCodeForToken(cfg, { code: 'auth-code', redirectUri: 'https://veyrnox.ai/social/connect/callback/tiktok' }, fetcher);
    assert.equal(result.accessToken, 'access-1');
    assert.equal(result.refreshToken, 'refresh-1');
    assert.ok(new Date(result.expiresAt).getTime() > Date.now());
    assert.equal(sentUrl, 'https://open.tiktokapis.com/v2/oauth/token/');
    assert.equal(sentHeaders['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(sentBody);
    assert.equal(params.get('client_key'), cfg.clientKey);
    assert.equal(params.get('client_secret'), cfg.clientSecret);
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('code'), 'auth-code');
    assert.equal(params.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/tiktok');
});

test('exchangeCodeForToken surfaces TikTok\'s error rather than swallowing it', async () => {
    const fetcher = async () => jsonRes({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired' }, 400);
    await assert.rejects(
        exchangeCodeForToken(cfg, { code: 'bad', redirectUri: 'https://veyrnox.ai/cb' }, fetcher),
        /Authorization code is invalid or expired/,
    );
});

test('fetchConnectedAccount resolves the account via GET /v2/user/info/', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        calls.push({ url, init });
        return jsonRes({ data: { user: { open_id: 'open-1', union_id: 'union-1', display_name: 'Creator Name', avatar_url: 'https://example.com/a.jpg' } }, error: { code: 'ok', message: '', log_id: 'x' } });
    };
    const account = await fetchConnectedAccount('user-token', fetcher);
    assert.deepEqual(account, { externalAccountId: 'open-1', displayName: 'Creator Name', avatarUrl: 'https://example.com/a.jpg' });
    assert.equal(new URL(calls[0].url).pathname, '/v2/user/info/');
    assert.equal(new URL(calls[0].url).searchParams.get('fields'), 'open_id,display_name,avatar_url');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer user-token');
});

test('fetchConnectedAccount surfaces a TikTok-envelope error even on HTTP 200', async () => {
    const fetcher = async () => jsonRes({ data: {}, error: { code: 'access_token_invalid', message: 'The access token is invalid', log_id: 'x' } }, 200);
    await assert.rejects(fetchConnectedAccount('bad-token', fetcher), /access token is invalid/);
});

test('fetchConnectedAccount surfaces a transport-level failure rather than crashing', async () => {
    const fetcher = async () => jsonRes({ error: { code: 'internal_error', message: 'server error' } }, 500);
    await assert.rejects(fetchConnectedAccount('token', fetcher), /server error/);
});

function jsonRes(body, status = 200) {
    return { ok: status < 400, status, json: async () => body };
}
