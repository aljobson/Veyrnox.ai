import test from 'node:test';
import assert from 'node:assert/strict';
import {
    instagramConfig, buildAuthorizeUrl, exchangeCodeForToken, fetchConnectedAccount,
} from '../packages/adapters/social/instagram.js';

const cfg = { appId: '123456789012345', appSecret: 'a'.repeat(32) };
const challenge = 'a'.repeat(43); // valid-shaped S256 challenge for these tests

test('instagramConfig rejects malformed or missing env', () => {
    assert.equal(instagramConfig({}), null);
    assert.equal(instagramConfig({ META_APP_ID: 'not-numeric', META_APP_SECRET: 'a'.repeat(32) }), null);
    assert.equal(instagramConfig({ META_APP_ID: '123456789012345', META_APP_SECRET: 'short' }), null);
    assert.deepEqual(instagramConfig({ META_APP_ID: '123456789012345', META_APP_SECRET: 'a'.repeat(32) }), cfg);
});

test('buildAuthorizeUrl includes PKCE, state and the exact v1 scopes', () => {
    const url = new URL(buildAuthorizeUrl(cfg, {
        redirectUri: 'https://veyrnox.ai/social/connect/callback', state: 'signed-state-token', codeChallenge: challenge,
    }));
    assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v21.0/dialog/oauth');
    assert.equal(url.searchParams.get('client_id'), cfg.appId);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback');
    assert.equal(url.searchParams.get('state'), 'signed-state-token');
    assert.equal(url.searchParams.get('code_challenge'), challenge);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement');
});

test('buildAuthorizeUrl refuses a non-https redirect and a malformed challenge', () => {
    assert.throws(() => buildAuthorizeUrl(cfg, { redirectUri: 'http://veyrnox.ai/cb', state: 's', codeChallenge: challenge }));
    assert.throws(() => buildAuthorizeUrl(cfg, { redirectUri: 'https://veyrnox.ai/cb', state: 's', codeChallenge: 'too-short' }));
});

test('exchangeCodeForToken performs the two-step short→long-lived swap', async () => {
    const calls = [];
    const fetcher = async (url) => {
        calls.push(new URL(url));
        if (calls.length === 1) return jsonRes({ access_token: 'short-lived-token' });
        return jsonRes({ access_token: 'long-lived-token', expires_in: 5184000 });
    };
    const result = await exchangeCodeForToken(cfg, {
        code: 'auth-code', codeVerifier: 'v'.repeat(43), redirectUri: 'https://veyrnox.ai/social/connect/callback',
    }, fetcher);
    assert.equal(result.accessToken, 'long-lived-token');
    assert.ok(new Date(result.expiresAt).getTime() > Date.now());
    assert.equal(calls[0].searchParams.get('code'), 'auth-code');
    assert.equal(calls[0].searchParams.get('code_verifier'), 'v'.repeat(43));
    assert.equal(calls[1].searchParams.get('grant_type'), 'fb_exchange_token');
    assert.equal(calls[1].searchParams.get('fb_exchange_token'), 'short-lived-token');
});

test('exchangeCodeForToken surfaces a Graph API error rather than swallowing it', async () => {
    const fetcher = async () => jsonRes({ error: { message: 'Invalid verification code format.' } }, 400);
    await assert.rejects(
        exchangeCodeForToken(cfg, { code: 'bad', codeVerifier: 'v'.repeat(43), redirectUri: 'https://veyrnox.ai/cb' }, fetcher),
        /Invalid verification code format/,
    );
});

test('fetchConnectedAccount resolves the Page with a linked Instagram Business Account', async () => {
    const calls = [];
    const fetcher = async (url) => {
        calls.push(new URL(url));
        if (calls.length === 1) {
            return jsonRes({
                data: [
                    { id: 'page-1', name: 'No IG Page' },
                    { id: 'page-2', name: 'Creator Page', access_token: 'page-token', instagram_business_account: { id: 'ig-42' } },
                ],
            });
        }
        return jsonRes({ username: 'creator', profile_picture_url: 'https://example.com/a.jpg' });
    };
    const account = await fetchConnectedAccount('user-token', fetcher);
    assert.deepEqual(account, {
        externalAccountId: 'ig-42', displayName: '@creator',
        avatarUrl: 'https://example.com/a.jpg', pageAccessToken: 'page-token',
    });
    assert.equal(calls[0].searchParams.get('access_token'), 'user-token');
    assert.equal(calls[1].searchParams.get('access_token'), 'page-token', 'profile lookup uses the Page token, not the user token');
});

test('fetchConnectedAccount reports NO_LINKED_INSTAGRAM_ACCOUNT as an expected user error, not a crash', async () => {
    const fetcher = async () => jsonRes({ data: [{ id: 'page-1', name: 'No IG Page' }] });
    await assert.rejects(fetchConnectedAccount('user-token', fetcher), (err) => err.code === 'NO_LINKED_INSTAGRAM_ACCOUNT');
});

function jsonRes(body, status = 200) {
    return { ok: status < 400, status, json: async () => body };
}
