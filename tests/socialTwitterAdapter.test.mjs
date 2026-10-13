import test from 'node:test';
import assert from 'node:assert/strict';
import {
    xConfig, buildAuthorizeUrl, exchangeCodeForToken, fetchConnectedAccount, publishPost, X_SCOPES,
    fetchAnalytics, refreshAccessToken,
} from '../packages/adapters/social/twitter.js';

const cfg = { clientId: 'test-client-id-abc123', clientSecret: 'a'.repeat(20) };
const challenge = 'a'.repeat(43);

test('xConfig rejects malformed or missing env', () => {
    assert.equal(xConfig({}), null);
    assert.equal(xConfig({ X_CLIENT_ID: 'has spaces here', X_CLIENT_SECRET: 'a'.repeat(20) }), null);
    assert.equal(xConfig({ X_CLIENT_ID: 'test-client-id-abc123', X_CLIENT_SECRET: 'short' }), null);
    assert.deepEqual(xConfig({ X_CLIENT_ID: 'test-client-id-abc123', X_CLIENT_SECRET: 'a'.repeat(20) }), cfg);
});

test('buildAuthorizeUrl includes PKCE, state and the exact v1 scopes (X requires PKCE, unlike LinkedIn)', () => {
    const url = new URL(buildAuthorizeUrl(cfg, {
        redirectUri: 'https://veyrnox.ai/social/connect/callback/twitter', state: 'signed-state-token', codeChallenge: challenge,
    }));
    assert.equal(url.origin + url.pathname, 'https://x.com/i/oauth2/authorize');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), cfg.clientId);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://veyrnox.ai/social/connect/callback/twitter');
    assert.equal(url.searchParams.get('state'), 'signed-state-token');
    assert.equal(url.searchParams.get('code_challenge'), challenge);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), 'tweet.read tweet.write users.read offline.access media.write');
    assert.deepEqual(X_SCOPES, ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write']);
});

test('buildAuthorizeUrl refuses a non-https redirect and a malformed challenge', () => {
    assert.throws(() => buildAuthorizeUrl(cfg, { redirectUri: 'http://veyrnox.ai/cb', state: 's', codeChallenge: challenge }));
    assert.throws(() => buildAuthorizeUrl(cfg, { redirectUri: 'https://veyrnox.ai/cb', state: 's', codeChallenge: 'too-short' }));
});

test('exchangeCodeForToken authenticates with HTTP Basic (confidential client), not a body secret', async () => {
    let sentUrl = null, sentBody = null, sentHeaders = null;
    const fetcher = async (url, init) => {
        sentUrl = url; sentBody = init.body; sentHeaders = init.headers;
        return jsonRes({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 7200, token_type: 'bearer', scope: 'tweet.read tweet.write' });
    };
    const result = await exchangeCodeForToken(cfg, { code: 'auth-code', codeVerifier: 'v'.repeat(43), redirectUri: 'https://veyrnox.ai/social/connect/callback/twitter' }, fetcher);
    assert.equal(result.accessToken, 'access-1');
    assert.equal(result.refreshToken, 'refresh-1');
    assert.ok(new Date(result.expiresAt).getTime() > Date.now());
    assert.equal(sentUrl, 'https://api.x.com/2/oauth2/token');
    assert.equal(sentHeaders.Authorization, `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`);
    const params = new URLSearchParams(sentBody);
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('code'), 'auth-code');
    assert.equal(params.get('code_verifier'), 'v'.repeat(43));
    assert.equal(params.get('client_id'), null, 'confidential clients authenticate via Basic auth, not a body client_id');
});

test('refreshAccessToken uses the refresh grant with Basic auth and keeps the old refresh token when none is returned', async () => {
    let sentBody = null, sentHeaders = null;
    const fetcher = async (_url, init) => { sentBody = init.body; sentHeaders = init.headers; return jsonRes({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 7200 }); };
    const r = await refreshAccessToken(cfg, 'refresh-1', fetcher);
    assert.deepEqual([r.accessToken, r.refreshToken], ['access-2', 'refresh-2']);
    assert.ok(new Date(r.expiresAt).getTime() > Date.now() + 7100 * 1000);
    assert.equal(sentHeaders.Authorization, `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`);
    const params = new URLSearchParams(sentBody);
    assert.equal(params.get('grant_type'), 'refresh_token');
    assert.equal(params.get('refresh_token'), 'refresh-1');
    const kept = await refreshAccessToken(cfg, 'refresh-1', async () => jsonRes({ access_token: 'access-3' }));
    assert.equal(kept.refreshToken, 'refresh-1', 'no rotation in the response: the old one still works');
    await assert.rejects(refreshAccessToken(cfg, 'bad', async () => jsonRes({ error: 'invalid_request' }, 400)), /invalid_request/);
});

test('exchangeCodeForToken surfaces X\'s error rather than swallowing it', async () => {
    const fetcher = async () => jsonRes({ error: 'invalid_grant', error_description: 'Value passed for the authorization code was invalid' }, 400);
    await assert.rejects(
        exchangeCodeForToken(cfg, { code: 'bad', codeVerifier: 'v'.repeat(43), redirectUri: 'https://veyrnox.ai/cb' }, fetcher),
        /authorization code was invalid/,
    );
});

test('fetchConnectedAccount resolves the account via GET /2/users/me', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        calls.push({ url, init });
        return jsonRes({ data: { id: '123456789', username: 'creator', name: 'Creator Name', profile_image_url: 'https://example.com/a.jpg' } });
    };
    const account = await fetchConnectedAccount('user-token', fetcher);
    assert.deepEqual(account, { externalAccountId: '123456789', username: 'creator', displayName: '@creator', avatarUrl: 'https://example.com/a.jpg' });
    assert.equal(new URL(calls[0].url).pathname, '/2/users/me');
    assert.equal(new URL(calls[0].url).searchParams.get('user.fields'), 'profile_image_url');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer user-token');
});

test('fetchConnectedAccount surfaces an upstream failure rather than crashing', async () => {
    const fetcher = async () => jsonRes({ title: 'Unauthorized' }, 401);
    await assert.rejects(fetchConnectedAccount('bad-token', fetcher), /Unauthorized/);
});

test('fetchAnalytics reads public account metrics and the latest original posts without relabelling impressions as views', async () => {
    const calls = [];
    const fetcher = async (url, init) => {
        calls.push({ url: String(url), init });
        const parsed = new URL(url);
        if (parsed.pathname === '/2/users/me') return jsonRes({ data: { id: '123456789', public_metrics: {
            followers_count: 42, following_count: 7, post_count: 12,
        } } });
        if (parsed.pathname === '/2/users/123456789/tweets') return jsonRes({ data: [
            { id: '2109946167664476281', created_at: '2026-10-13T10:20:30.000Z', text: 'Hello from Veyrnox', public_metrics: {
                impression_count: 1000, like_count: 11, reply_count: 2, bookmark_count: 3,
                repost_count: 4, quote_count: 5,
            } },
            { id: '2109946167664476282', created_at: '2026-10-12T10:20:30Z', text: '=formula', public_metrics: {
                impression_count: 80, like_count: 1, reply_count: 0, bookmark_count: 0,
                retweet_count: 2, quote_count: 1,
            } },
        ], meta: { result_count: 2 } });
        throw new Error(`unexpected url: ${url}`);
    };
    const result = await fetchAnalytics('user-token', { externalAccountId: '123456789' }, fetcher);
    assert.deepEqual(result.metrics, { followers: 42, following: 7, posts_count: 12 });
    assert.deepEqual(result.posts[0], {
        id: '2109946167664476281', published_at: '2026-10-13T10:20:30.000Z', type: 'post',
        permalink: 'https://x.com/i/web/status/2109946167664476281', caption: 'Hello from Veyrnox',
        metrics: { impressions: 1000, likes: 11, comments: 2, saves: 3, shares: 9 },
    });
    assert.equal(result.posts[1].metrics.shares, 3, 'former retweet_count response spelling remains supported');
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0].url).searchParams.get('user.fields'), 'public_metrics');
    const postsUrl = new URL(calls[1].url);
    assert.equal(postsUrl.searchParams.get('max_results'), '100');
    assert.equal(postsUrl.searchParams.get('exclude'), 'replies,retweets');
    assert.equal(postsUrl.searchParams.get('tweet.fields'), 'created_at,public_metrics,text');
    assert.ok(calls.every((call) => call.init.headers.Authorization === 'Bearer user-token'));
    assert.ok(!('views' in result.posts[0].metrics), 'impressions are not video views');
});

test('fetchAnalytics accepts an empty X timeline and the former tweet_count account field', async () => {
    let call = 0;
    const fetcher = async () => ++call === 1
        ? jsonRes({ data: { id: '123', public_metrics: { followers_count: 1, tweet_count: 9 } } })
        : jsonRes({ meta: { result_count: 0 } });
    assert.deepEqual(await fetchAnalytics('token', { externalAccountId: '123' }, fetcher), {
        metrics: { followers: 1, posts_count: 9 }, posts: [],
    });
});

test('fetchAnalytics rejects an account mismatch, invalid response and upstream failure', async () => {
    await assert.rejects(fetchAnalytics('token', { externalAccountId: 'expected' }, async () =>
        jsonRes({ data: { id: 'other', public_metrics: {} } })), /x_account_mismatch/);
    let call = 0;
    await assert.rejects(fetchAnalytics('token', { externalAccountId: '123' }, async () => ++call === 1
        ? jsonRes({ data: { id: '123', public_metrics: {} } }) : jsonRes({ nope: true })), /x_analytics_invalid_response/);
    await assert.rejects(fetchAnalytics('token', { externalAccountId: '123' }, async () =>
        jsonRes({ title: 'private vendor detail' }, 429)), /x_analytics_failed_429/);
});

test('publishPost refuses anything but an image, without calling the API', async () => {
    const fetcher = async () => { throw new Error('must not be called'); };
    await assert.rejects(
        publishPost('token', { mediaType: 'video', mediaUrl: 'https://example.com/v.mp4' }, fetcher),
        (err) => err.code === 'UNSUPPORTED_MEDIA_TYPE',
    );
});

test('publishPost initializes, appends one segment, finalizes, then creates the tweet', async () => {
    const calls = [];
    const fetcher = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url) === 'https://example.com/photo.jpg') {
            return { ok: true, status: 200, headers: headerGet({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
        }
        if (String(url) === 'https://api.x.com/2/media/upload/initialize') {
            return jsonRes({ data: { id: 'media-1', media_key: 'key-1', expires_after_secs: 86400 } });
        }
        if (String(url) === 'https://api.x.com/2/media/upload/media-1/append') {
            return { ok: true, status: 204, headers: headerGet({}) };
        }
        if (String(url) === 'https://api.x.com/2/media/upload/media-1/finalize') {
            return jsonRes({ data: { id: 'media-1', media_key: 'key-1' } }); // no processing_info: images finalize synchronously
        }
        if (String(url) === 'https://api.x.com/2/tweets') {
            return jsonRes({ data: { id: 'tweet-1', text: 'hello world', edit_history_tweet_ids: ['tweet-1'] } }, 201);
        }
        throw new Error(`unexpected url: ${url}`);
    };
    const result = await publishPost('token', {
        username: 'creator', caption: 'hello world', mediaType: 'image', mediaUrl: 'https://example.com/photo.jpg',
    }, fetcher);
    assert.deepEqual(result, { platformPostId: 'tweet-1', platformPostUrl: 'https://x.com/creator/status/tweet-1' });

    const init = calls.find((c) => c.url.endsWith('/media/upload/initialize'));
    assert.equal(init.init.method, 'POST');
    assert.deepEqual(JSON.parse(init.init.body), { media_type: 'image/jpeg', total_bytes: 3, media_category: 'tweet_image' });

    const append = calls.find((c) => c.url.endsWith('/media/upload/media-1/append'));
    assert.equal(append.init.method, 'POST');
    assert.ok(append.init.body instanceof FormData);

    const tweet = calls.find((c) => c.url === 'https://api.x.com/2/tweets');
    assert.deepEqual(JSON.parse(tweet.init.body), { text: 'hello world', media: { media_ids: ['media-1'] } });
});

test('publishPost falls back to the handle-agnostic permalink when no username is available', async () => {
    const fetcher = async (url) => {
        if (String(url) === 'https://example.com/photo.jpg') {
            return { ok: true, status: 200, headers: headerGet({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1]).buffer };
        }
        if (String(url) === 'https://api.x.com/2/media/upload/initialize') return jsonRes({ data: { id: 'media-1' } });
        if (String(url) === 'https://api.x.com/2/media/upload/media-1/append') return { ok: true, status: 204, headers: headerGet({}) };
        if (String(url) === 'https://api.x.com/2/media/upload/media-1/finalize') return jsonRes({ data: { id: 'media-1' } });
        if (String(url) === 'https://api.x.com/2/tweets') return jsonRes({ data: { id: 'tweet-1' } }, 201);
        throw new Error(`unexpected url: ${url}`);
    };
    const result = await publishPost('token', { mediaType: 'image', mediaUrl: 'https://example.com/photo.jpg' }, fetcher);
    assert.equal(result.platformPostUrl, 'https://x.com/i/web/status/tweet-1');
});

test('publishPost refuses an image over the single-append size cap rather than truncating it', async () => {
    const fetcher = async (url) => {
        if (String(url) === 'https://example.com/big.jpg') {
            return { ok: true, status: 200, headers: headerGet({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new ArrayBuffer(6 * 1024 * 1024) };
        }
        throw new Error(`unexpected url: ${url}`);
    };
    await assert.rejects(
        publishPost('token', { mediaType: 'image', mediaUrl: 'https://example.com/big.jpg' }, fetcher),
        /image_too_large_for_single_append/,
    );
});

test('publishPost surfaces a failed media init rather than swallowing it', async () => {
    const fetcher = async (url) => {
        if (String(url) === 'https://example.com/a.jpg') {
            return { ok: true, status: 200, headers: headerGet({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1]).buffer };
        }
        return jsonRes({ title: 'Media upload quota exceeded' }, 429);
    };
    await assert.rejects(
        publishPost('token', { mediaType: 'image', mediaUrl: 'https://example.com/a.jpg' }, fetcher),
        /quota exceeded/,
    );
});

function headerGet(values) {
    return { get: (k) => values[k.toLowerCase()] ?? null };
}
function jsonRes(body, status = 200) {
    return { ok: status < 400, status, headers: headerGet({}), json: async () => body };
}
