import test from 'node:test';
import assert from 'node:assert/strict';
import {
    instagramConfig, buildAuthorizeUrl, exchangeCodeForToken, fetchConnectedAccount, publishPost, fetchAnalytics, instagramScopes, INSTAGRAM_SCOPES,
} from '../packages/adapters/social/instagram.js';

const cfg = { appId: '123456789012345', appSecret: 'a'.repeat(32), insights: false };

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

test('fetchAnalytics reads account totals and recent posts with the basic scope only', async () => {
    const calls = [];
    const fetcher = async (url) => {
        calls.push(new URL(url));
        if (calls.length === 1) return jsonRes({ followers_count: 1200, follows_count: 80, media_count: 42, id: '1' });
        return jsonRes({ data: [
            { id: 'm-1', caption: 'x'.repeat(600), media_type: 'VIDEO', media_product_type: 'REELS',
                permalink: 'https://www.instagram.com/reel/abc/', timestamp: '2026-09-30T10:00:00+0000', like_count: 30, comments_count: 4 },
            { id: 'm-2', media_type: 'IMAGE', media_product_type: 'FEED', timestamp: '2026-09-29T08:30:00+0000', comments_count: 1 },
            { id: 'm-3', media_type: 'IMAGE', timestamp: 'not a date', like_count: 5 },
            { media_type: 'IMAGE', timestamp: '2026-09-28T08:30:00+0000' },
        ] });
    };
    const result = await fetchAnalytics('token', {}, fetcher);

    assert.equal(calls[0].pathname, '/v25.0/me');
    assert.equal(calls[0].searchParams.get('fields'), 'followers_count,follows_count,media_count');
    assert.equal(calls[1].pathname, '/v25.0/me/media');
    assert.equal(calls[1].searchParams.get('limit'), '50');
    assert.ok(!calls.some((u) => u.pathname.includes('insights')), 'insights need a scope the connect flow does not request');
    assert.deepEqual(result.metrics, { followers: 1200, following: 80, posts_count: 42 });
    assert.deepEqual(result.posts, [
        { id: 'm-1', published_at: '2026-09-30T10:00:00.000Z', type: 'reel', permalink: 'https://www.instagram.com/reel/abc/',
            caption: 'x'.repeat(500), metrics: { likes: 30, comments: 4 } },
        // A hidden like count is left out, not reported as zero.
        { id: 'm-2', published_at: '2026-09-29T08:30:00.000Z', type: 'image', permalink: null, caption: null, metrics: { comments: 1 } },
    ]);
});

test('fetchAnalytics surfaces a Graph API error and tolerates an empty media list', async () => {
    await assert.rejects(fetchAnalytics('token', {}, async () => jsonRes({ error: { message: 'Session has expired' } }, 400)), /Session has expired/);
    let n = 0;
    const result = await fetchAnalytics('token', {}, async () => (++n === 1 ? jsonRes({ followers_count: 3 }) : jsonRes({})));
    assert.deepEqual(result, { metrics: { followers: 3 }, posts: [] });
});

test('the insights permission is requested only when the deployment switches it on', () => {
    const on = instagramConfig({ META_APP_ID: '123456789012345', META_APP_SECRET: 'a'.repeat(32), INSTAGRAM_INSIGHTS_SCOPE_ENABLED: 'true' });
    assert.equal(on.insights, true);
    assert.equal(instagramConfig({ META_APP_ID: '123456789012345', META_APP_SECRET: 'a'.repeat(32), INSTAGRAM_INSIGHTS_SCOPE_ENABLED: '1' }).insights, false);
    assert.deepEqual(instagramScopes(cfg), INSTAGRAM_SCOPES);
    assert.deepEqual(instagramScopes(on), [...INSTAGRAM_SCOPES, 'instagram_business_manage_insights']);
    const url = new URL(buildAuthorizeUrl(on, { redirectUri: 'https://veyrnox.ai/social/connect/callback/instagram', state: 's' }));
    assert.equal(url.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights');
});

test('fetchAnalytics with insights adds reach, views, saves and shares for the newest posts and the account\'s last day', async () => {
    const calls = [];
    const media = Array.from({ length: 12 }, (_, i) => ({
        id: `m-${i}`, media_type: 'IMAGE', timestamp: '2026-09-30T10:00:00+0000', like_count: 1, comments_count: 0,
    }));
    const fetcher = async (url) => {
        const u = new URL(url);
        calls.push(u);
        if (u.pathname === '/v25.0/me') return jsonRes({ followers_count: 100 });
        if (u.pathname === '/v25.0/me/media') return jsonRes({ data: media });
        if (u.pathname === '/v25.0/me/insights') {
            return jsonRes({ data: [{ name: 'reach', period: 'day', total_value: { value: 450 } }, { name: 'accounts_engaged', total_value: { value: 37 } }] });
        }
        if (u.pathname === '/v25.0/m-1/insights') return jsonRes({ error: { message: 'unsupported for this media' } }, 400);
        return jsonRes({ data: [
            { name: 'reach', period: 'lifetime', values: [{ value: 300 }] }, { name: 'views', values: [{ value: 520 }] },
            { name: 'saved', values: [{ value: 9 }] }, { name: 'shares', values: [{ value: 'n/a' }] },
        ] });
    };
    const now = new Date('2026-10-03T12:00:00Z');
    const result = await fetchAnalytics('token', { insights: true, now }, fetcher);

    assert.deepEqual(result.metrics, { followers: 100, reach: 450, accounts_engaged: 37 });
    assert.deepEqual(result.posts[0].metrics, { likes: 1, comments: 0, reach: 300, views: 520, saves: 9 });
    assert.deepEqual(result.posts[1].metrics, { likes: 1, comments: 0 }, 'a post whose insights call fails keeps its basic numbers');
    assert.deepEqual(result.posts[10].metrics, { likes: 1, comments: 0 }, 'only the newest ten posts are refreshed');
    const postCalls = calls.filter((u) => /\/m-\d+\/insights$/.test(u.pathname));
    assert.equal(postCalls.length, 10);
    assert.equal(postCalls[0].searchParams.get('metric'), 'reach,views,saved,shares');
    const account = calls.find((u) => u.pathname === '/v25.0/me/insights');
    assert.equal(account.searchParams.get('metric'), 'reach,accounts_engaged');
    assert.equal(account.searchParams.get('period'), 'day');
    assert.equal(account.searchParams.get('metric_type'), 'total_value');
    assert.equal(account.searchParams.get('until'), String(now.getTime() / 1000));
    assert.equal(account.searchParams.get('since'), String(now.getTime() / 1000 - 86400));
});

test('fetchAnalytics still returns the basic numbers when the account insights call fails', async () => {
    const fetcher = async (url) => {
        const u = new URL(url);
        if (u.pathname === '/v25.0/me') return jsonRes({ followers_count: 100 });
        if (u.pathname === '/v25.0/me/media') return jsonRes({ data: [] });
        return jsonRes({ error: { message: 'permission denied' } }, 403);
    };
    assert.deepEqual(await fetchAnalytics('token', { insights: true }, fetcher), { metrics: { followers: 100 }, posts: [] });
});

function jsonRes(body, status = 200) {
    return { ok: status < 400, status, json: async () => body };
}
