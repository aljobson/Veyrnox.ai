import test from 'node:test';
import assert from 'node:assert/strict';
import {
    linkedinConfig, buildAuthorizeUrl, exchangeCodeForToken, fetchConnectedAccount, publishPost, LINKEDIN_SCOPES,
} from '../packages/adapters/social/linkedin.js';

const cfg = { clientId: 'testclientid123', clientSecret: 'a'.repeat(20) };

test('linkedinConfig rejects malformed or missing env', () => {
    assert.equal(linkedinConfig({}), null);
    assert.equal(linkedinConfig({ LINKEDIN_CLIENT_ID: 'has spaces', LINKEDIN_CLIENT_SECRET: 'a'.repeat(20) }), null);
    assert.equal(linkedinConfig({ LINKEDIN_CLIENT_ID: 'testclientid123', LINKEDIN_CLIENT_SECRET: 'short' }), null);
    assert.deepEqual(linkedinConfig({ LINKEDIN_CLIENT_ID: 'testclientid123', LINKEDIN_CLIENT_SECRET: 'a'.repeat(20) }), cfg);
});

test('buildAuthorizeUrl includes state and the exact v1 scopes, with no PKCE params LinkedIn does not document', () => {
    const url = new URL(buildAuthorizeUrl(cfg, {
        redirectUri: 'https://veyrnox.ai/social/connect/callback/linkedin', state: 'signed-state-token',
    }));
    assert.equal(url.origin + url.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), cfg.clientId);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/linkedin');
    assert.equal(url.searchParams.get('state'), 'signed-state-token');
    assert.equal(url.searchParams.get('scope'), 'openid profile w_member_social');
    assert.equal(url.searchParams.get('code_challenge'), null, 'LinkedIn has no documented PKCE support');
    assert.deepEqual(LINKEDIN_SCOPES, ['openid', 'profile', 'w_member_social']);
});

test('buildAuthorizeUrl refuses a non-https redirect', () => {
    assert.throws(() => buildAuthorizeUrl(cfg, { redirectUri: 'http://veyrnox.ai/cb', state: 's' }));
});

test('exchangeCodeForToken posts form-urlencoded and captures the refresh token LinkedIn (unlike Meta) issues', async () => {
    let sentUrl = null, sentBody = null, sentHeaders = null;
    const fetcher = async (url, init) => {
        sentUrl = url; sentBody = init.body; sentHeaders = init.headers;
        return jsonRes({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 5184000, scope: 'openid profile w_member_social' });
    };
    const result = await exchangeCodeForToken(cfg, { code: 'auth-code', redirectUri: 'https://veyrnox.ai/social/connect/callback/linkedin' }, fetcher);
    assert.equal(result.accessToken, 'access-1');
    assert.equal(result.refreshToken, 'refresh-1');
    assert.ok(new Date(result.expiresAt).getTime() > Date.now());
    assert.equal(sentUrl, 'https://www.linkedin.com/oauth/v2/accessToken');
    assert.equal(sentHeaders['Content-Type'], 'application/x-www-form-urlencoded');
    const params = new URLSearchParams(sentBody);
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('code'), 'auth-code');
    assert.equal(params.get('client_id'), cfg.clientId);
    assert.equal(params.get('client_secret'), cfg.clientSecret);
    assert.equal(params.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/linkedin');
});

test('exchangeCodeForToken tolerates a response with no refresh_token', async () => {
    const fetcher = async () => jsonRes({ access_token: 'access-1', expires_in: 5184000 });
    const result = await exchangeCodeForToken(cfg, { code: 'c', redirectUri: 'https://veyrnox.ai/cb' }, fetcher);
    assert.equal(result.refreshToken, null);
});

test('exchangeCodeForToken surfaces LinkedIn\'s error rather than swallowing it', async () => {
    const fetcher = async () => jsonRes({ error: 'invalid_grant', error_description: 'authorization code not found' }, 400);
    await assert.rejects(
        exchangeCodeForToken(cfg, { code: 'bad', redirectUri: 'https://veyrnox.ai/cb' }, fetcher),
        /authorization code not found/,
    );
});

test('fetchConnectedAccount resolves the OIDC identity via /v2/userinfo', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        calls.push({ url, init });
        return jsonRes({ sub: 'member-42', name: 'Ada Lovelace', picture: 'https://media.licdn-ei.com/a.jpg' });
    };
    const account = await fetchConnectedAccount('user-token', fetcher);
    assert.deepEqual(account, { externalAccountId: 'member-42', displayName: 'Ada Lovelace', avatarUrl: 'https://media.licdn-ei.com/a.jpg' });
    assert.equal(calls[0].url, 'https://api.linkedin.com/v2/userinfo');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer user-token');
});

test('fetchConnectedAccount surfaces an upstream failure rather than crashing on undefined fields', async () => {
    const fetcher = async () => jsonRes({ message: 'invalid token' }, 401);
    await assert.rejects(fetchConnectedAccount('bad-token', fetcher), /invalid token/);
});

test('publishPost refuses anything but an image, without calling the API', async () => {
    const fetcher = async () => { throw new Error('must not be called'); };
    await assert.rejects(
        publishPost('token', { externalAccountId: 'member-42', mediaType: 'video', mediaUrl: 'https://example.com/v.mp4' }, fetcher),
        (err) => err.code === 'UNSUPPORTED_MEDIA_TYPE',
    );
});

test('publishPost initializes an image upload, PUTs the source bytes through, then creates the post', async () => {
    const calls = [];
    const headerGet = (values) => ({ get: (k) => values[k.toLowerCase()] ?? null });
    const fetcher = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url) === 'https://api.linkedin.com/rest/images?action=initializeUpload') {
            return {
                ok: true, status: 200, headers: headerGet({}),
                json: async () => ({ value: { uploadUrl: 'https://www.linkedin.com/dms-uploads/abc/0', image: 'urn:li:image:abc' } }),
            };
        }
        if (String(url) === 'https://example.com/photo.jpg') {
            return { ok: true, status: 200, headers: headerGet({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
        }
        if (String(url) === 'https://www.linkedin.com/dms-uploads/abc/0') {
            return { ok: true, status: 201, headers: headerGet({}) };
        }
        if (String(url) === 'https://api.linkedin.com/rest/posts') {
            return { ok: true, status: 201, headers: headerGet({ 'x-restli-id': 'urn:li:share:123' }), json: async () => ({}) };
        }
        throw new Error(`unexpected url: ${url}`);
    };
    const result = await publishPost('token', {
        externalAccountId: 'member-42', caption: 'hello world', mediaType: 'image', mediaUrl: 'https://example.com/photo.jpg',
    }, fetcher);
    assert.deepEqual(result, { platformPostId: 'urn:li:share:123', platformPostUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123/' });

    const init = calls.find((c) => c.url.includes('initializeUpload'));
    assert.equal(init.init.method, 'POST');
    assert.equal(init.init.headers['Linkedin-Version'], '202509');
    assert.equal(init.init.headers['X-Restli-Protocol-Version'], '2.0.0');
    assert.deepEqual(JSON.parse(init.init.body), { initializeUploadRequest: { owner: 'urn:li:person:member-42' } });

    const upload = calls.find((c) => c.url === 'https://www.linkedin.com/dms-uploads/abc/0');
    assert.equal(upload.init.method, 'PUT');
    assert.equal(upload.init.headers['Content-Type'], 'image/jpeg');
    assert.equal(upload.init.headers.Authorization, 'Bearer token');

    const post = calls.find((c) => c.url === 'https://api.linkedin.com/rest/posts');
    const postBody = JSON.parse(post.init.body);
    assert.equal(postBody.author, 'urn:li:person:member-42');
    assert.equal(postBody.commentary, 'hello world');
    assert.equal(postBody.content.media.id, 'urn:li:image:abc');
    assert.equal(postBody.lifecycleState, 'PUBLISHED');
});

test('publishPost surfaces a failed image init rather than swallowing it', async () => {
    const fetcher = async () => jsonRes({ message: 'quota exceeded' }, 429);
    await assert.rejects(
        publishPost('token', { externalAccountId: 'member-42', mediaType: 'image', mediaUrl: 'https://example.com/a.jpg' }, fetcher),
        /quota exceeded/,
    );
});

function jsonRes(body, status = 200) {
    return { ok: status < 400, status, headers: { get: () => null }, json: async () => body };
}
