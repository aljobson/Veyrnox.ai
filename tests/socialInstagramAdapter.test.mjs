import test from 'node:test';
import assert from 'node:assert/strict';
import {
    instagramConfig, buildAuthorizeUrl, exchangeCodeForToken, fetchConnectedAccount, publishPost, INSTAGRAM_SCOPES,
} from '../packages/adapters/social/instagram.js';

const cfg = { appId: '123456789012345', appSecret: 'a'.repeat(32) };

test('instagramConfig rejects malformed or missing env', () => {
    assert.equal(instagramConfig({}), null);
    assert.equal(instagramConfig({ META_APP_ID: 'not-numeric', META_APP_SECRET: 'a'.repeat(32) }), null);
    assert.equal(instagramConfig({ META_APP_ID: '123456789012345', META_APP_SECRET: 'short' }), null);
    assert.deepEqual(instagramConfig({ META_APP_ID: '123456789012345', META_APP_SECRET: 'a'.repeat(32) }), cfg);
});

test('buildAuthorizeUrl uses Instagram Login (not Facebook Login) with state and the exact v1 scopes, and no PKCE params it does not document', () => {
    const url = new URL(buildAuthorizeUrl(cfg, {
        redirectUri: 'https://veyrnox.ai/social/connect/callback/instagram', state: 'signed-state-token',
    }));
    assert.equal(url.origin + url.pathname, 'https://www.instagram.com/oauth/authorize');
    assert.equal(url.searchParams.get('client_id'), cfg.appId);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/instagram');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), 'signed-state-token');
    assert.equal(url.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish');
    assert.equal(url.searchParams.get('code_challenge'), null, 'Instagram Login has no documented PKCE support');
    assert.deepEqual(INSTAGRAM_SCOPES, ['instagram_business_basic', 'instagram_business_content_publish']);
});

test('buildAuthorizeUrl refuses a non-https redirect', () => {
    assert.throws(() => buildAuthorizeUrl(cfg, { redirectUri: 'http://veyrnox.ai/cb', state: 's' }));
});

test('exchangeCodeForToken performs the two-step short→long-lived swap against Instagram Login\'s own endpoints', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        calls.push({ url: new URL(url), init });
        if (calls.length === 1) return jsonRes({ data: [{ access_token: 'short-lived-token', user_id: '17841400000000000', permissions: 'instagram_business_basic' }] });
        return jsonRes({ access_token: 'long-lived-token', token_type: 'bearer', expires_in: 5184000 });
    };
    const result = await exchangeCodeForToken(cfg, {
        code: 'auth-code', redirectUri: 'https://veyrnox.ai/social/connect/callback/instagram',
    }, fetcher);
    assert.equal(result.accessToken, 'long-lived-token');
    assert.ok(new Date(result.expiresAt).getTime() > Date.now());
    assert.equal(calls[0].url.toString(), 'https://api.instagram.com/oauth/access_token');
    assert.equal(calls[0].init.method, 'POST');
    const shortBody = new URLSearchParams(calls[0].init.body);
    assert.equal(shortBody.get('grant_type'), 'authorization_code');
    assert.equal(shortBody.get('code'), 'auth-code');
    assert.equal(shortBody.get('client_secret'), cfg.appSecret);
    assert.equal(calls[1].url.origin + calls[1].url.pathname, 'https://graph.instagram.com/access_token');
    assert.equal(calls[1].url.searchParams.get('grant_type'), 'ig_exchange_token');
    assert.equal(calls[1].url.searchParams.get('access_token'), 'short-lived-token');
});

test('exchangeCodeForToken surfaces a malformed short-lived response rather than a raw crash', async () => {
    const fetcher = async () => jsonRes({ data: [] });
    await assert.rejects(exchangeCodeForToken(cfg, { code: 'c', redirectUri: 'https://veyrnox.ai/cb' }, fetcher), /token_exchange_failed/);
});

test('exchangeCodeForToken surfaces a Graph API error rather than swallowing it', async () => {
    const fetcher = async () => jsonRes({ error_message: 'Invalid verification code format.' }, 400);
    await assert.rejects(
        exchangeCodeForToken(cfg, { code: 'bad', redirectUri: 'https://veyrnox.ai/cb' }, fetcher),
        /Invalid verification code format/,
    );
});

test('fetchConnectedAccount resolves the Instagram account directly, with no Page-resolution chain', async () => {
    const calls = [];
    const fetcher = async (url) => {
        calls.push(new URL(url));
        return jsonRes({ id: '17841400000000000', username: 'creator', profile_picture_url: 'https://example.com/a.jpg' });
    };
    const account = await fetchConnectedAccount('user-token', fetcher);
    assert.deepEqual(account, {
        externalAccountId: '17841400000000000', displayName: '@creator', avatarUrl: 'https://example.com/a.jpg',
    });
    assert.equal(calls.length, 1, 'no Pages lookup — one direct call');
    assert.equal(calls[0].origin + calls[0].pathname, 'https://graph.instagram.com/v25.0/me');
    assert.equal(calls[0].searchParams.get('access_token'), 'user-token');
});

test('fetchConnectedAccount surfaces an upstream failure rather than crashing', async () => {
    const fetcher = async () => jsonRes({ error: { message: 'invalid token' } }, 401);
    await assert.rejects(fetchConnectedAccount('bad-token', fetcher), /invalid token/);
});

test('publishPost refuses anything but an image, without calling the Graph API', async () => {
    const fetcher = async () => { throw new Error('must not be called'); };
    await assert.rejects(
        publishPost('token', { externalAccountId: 'ig-42', mediaType: 'video', mediaUrl: 'https://example.com/v.mp4' }, fetcher),
        (err) => err.code === 'UNSUPPORTED_MEDIA_TYPE',
    );
});

test('publishPost creates a media container, publishes it, and resolves the real permalink', async () => {
    const calls = [];
    const fetcher = async (url) => {
        calls.push(new URL(url));
        if (calls.length === 1) return jsonRes({ id: 'container-1' });
        if (calls.length === 2) return jsonRes({ id: '17895695668004550' });
        return jsonRes({ id: '17895695668004550', permalink: 'https://www.instagram.com/p/Cxyz123/' });
    };
    const result = await publishPost('token', {
        externalAccountId: 'ig-42', caption: 'hello world', mediaType: 'image', mediaUrl: 'https://example.com/a.jpg',
    }, fetcher);
    assert.deepEqual(result, { platformPostId: '17895695668004550', platformPostUrl: 'https://www.instagram.com/p/Cxyz123/' });
    assert.equal(calls[0].pathname, '/v25.0/ig-42/media');
    assert.equal(calls[0].searchParams.get('image_url'), 'https://example.com/a.jpg');
    assert.equal(calls[0].searchParams.get('caption'), 'hello world');
    assert.equal(calls[1].pathname, '/v25.0/ig-42/media_publish');
    assert.equal(calls[1].searchParams.get('creation_id'), 'container-1');
    assert.equal(calls[2].pathname, '/v25.0/17895695668004550');
});

test('publishPost still reports success when the permalink lookup itself fails', async () => {
    const calls = [];
    const fetcher = async (url) => {
        calls.push(new URL(url));
        if (calls.length === 1) return jsonRes({ id: 'container-1' });
        if (calls.length === 2) return jsonRes({ id: 'media-1' });
        return jsonRes({ error: { message: 'transient' } }, 500);
    };
    const result = await publishPost('token', {
        externalAccountId: 'ig-42', mediaType: 'image', mediaUrl: 'https://example.com/a.jpg',
    }, fetcher);
    assert.deepEqual(result, { platformPostId: 'media-1', platformPostUrl: null });
});

test('publishPost surfaces a failed container or publish step rather than swallowing it', async () => {
    const containerFails = async () => jsonRes({ error: { message: 'Invalid image URL' } }, 400);
    await assert.rejects(
        publishPost('token', { externalAccountId: 'ig-42', mediaType: 'image', mediaUrl: 'https://example.com/a.jpg' }, containerFails),
        /Invalid image URL/,
    );
});

function jsonRes(body, status = 200) {
    return { ok: status < 400, status, json: async () => body };
}
