import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAnalytics, refreshAccessToken, tiktokConfig, buildAuthorizeUrl } from '../packages/adapters/social/tiktok.js';
const scopes = ['user.info.basic', 'user.info.stats', 'video.list'];
const cfg = { clientKey: 'testclientkey', clientSecret: 'test-secret' };
const account = { externalAccountId: 'open-1', scopes };
const envelope = (data) => Response.json({ data, error: { code: 'ok' } });
const video = (id = '1234567890123456789', changes = {}) => ({ id, create_time: 1791028800,
    title: 'Title', video_description: 'Caption', share_url: 'https://www.tiktok.com/@creator/video/' + id,
    view_count: 100, like_count: 10, comment_count: 2, share_count: 3, ...changes });
const profile = { user: { open_id: 'open-1', follower_count: 200, following_count: 12, likes_count: 700, video_count: 80 } };

test('analytics consent requires the exact true switch; base connect scopes stay unchanged', () => {
    for (const flag of [undefined, 'false', '1', 'TRUE']) {
        const config = tiktokConfig({ TIKTOK_CLIENT_KEY: cfg.clientKey, TIKTOK_CLIENT_SECRET: cfg.clientSecret, TIKTOK_ANALYTICS_SCOPE_ENABLED: flag });
        assert.equal(new URL(buildAuthorizeUrl(config, { redirectUri: 'https://veyrnox.ai/cb' })).searchParams.get('scope'), 'user.info.basic,video.upload');
    }
    const config = tiktokConfig({ TIKTOK_CLIENT_KEY: cfg.clientKey, TIKTOK_CLIENT_SECRET: cfg.clientSecret, TIKTOK_ANALYTICS_SCOPE_ENABLED: 'true' });
    assert.equal(new URL(buildAuthorizeUrl(config, { redirectUri: 'https://veyrnox.ai/cb' })).searchParams.get('scope'), 'user.info.basic,video.upload,user.info.stats,video.list');
});

test('reads the connected identity and statistics, then public video counters with server bearer auth', async () => {
    const calls = [];
    const out = await fetchAnalytics('private-token', account, async (url, init) => {
        calls.push({ url: new URL(url), init });
        assert.equal(init.headers.Authorization, 'Bearer private-token');
        assert.ok(init.signal);
        return envelope(calls.length === 1 ? profile : { videos: [video()], has_more: false });
    });
    assert.deepEqual(out.metrics, { followers: 200, following: 12, likes: 700, posts_count: 80 });
    assert.deepEqual(out.posts[0].metrics, { views: 100, likes: 10, comments: 2, shares: 3 });
    assert.equal(out.posts[0].caption, 'Caption');
    assert.equal(out.posts[0].published_at, new Date(1791028800 * 1000).toISOString());
    assert.equal(calls[0].url.pathname, '/v2/user/info/');
    assert.match(calls[0].url.searchParams.get('fields'), /follower_count/);
    assert.equal(calls[1].url.pathname, '/v2/video/list/');
    assert.equal(calls[1].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[1].init.body), { max_count: 20 });
});

test('limits pagination to 50 videos and three list calls even when more exist', async () => {
    let calls = 0;
    const sizes = [];
    const out = await fetchAnalytics('token', account, async (url, init) => {
        if (new URL(url).pathname.includes('user/info')) return envelope(profile);
        const body = JSON.parse(init.body);
        sizes.push(body.max_count);
        if (calls) assert.equal(body.cursor, calls * 1000);
        calls++;
        return envelope({ videos: Array.from({ length: body.max_count }, (_, i) => video(String(100 + calls * 20 + i))), cursor: calls * 1000, has_more: true });
    });
    assert.deepEqual(sizes, [20, 20, 10]);
    assert.equal(out.posts.length, 50);
});

test('partial grants only fetch the fields and endpoints actually granted', async () => {
    for (const granted of [['user.info.stats'], ['video.list']]) {
        const calls = [];
        const out = await fetchAnalytics('token', { ...account, scopes: granted }, async (url) => {
            const u = new URL(url); calls.push(u);
            return envelope(u.pathname.includes('user/info') ? profile : { videos: [], has_more: false });
        });
        assert.equal(calls.length, granted[0] === 'video.list' ? 2 : 1);
        if (granted[0] === 'video.list') {
            assert.equal(calls[0].searchParams.get('fields'), 'open_id');
            assert.deepEqual(out.metrics, {});
        }
    }
    await assert.rejects(fetchAnalytics('token', { ...account, scopes: ['user.info.basic'] }, () => { throw new Error('must not fetch'); }), /permission_required/);
});

test('refuses a different connected account before reading its videos', async () => {
    let calls = 0;
    await assert.rejects(fetchAnalytics('token', account, async () => { calls++; return envelope({ user: { open_id: 'stranger' } }); }), /account_mismatch/);
    assert.equal(calls, 1);
});

test('omits invalid counters, dates, ids and unsafe links without converting missing data to zero', async () => {
    const out = await fetchAnalytics('token', account, async (url) => envelope(new URL(url).pathname.includes('user/info')
        ? { user: { open_id: 'open-1', follower_count: -1, likes_count: null } }
        : { videos: [video('1', { view_count: -1, like_count: null, comment_count: '2', share_count: 0, share_url: 'https://evil.test/' }),
            video('2', { create_time: 'bad' }), video('3', { create_time: 1e15 }), video('bad'), video('1')], has_more: false }));
    assert.deepEqual(out.metrics, {});
    assert.equal(out.posts.length, 1);
    assert.deepEqual(out.posts[0].metrics, { shares: 0 });
    assert.equal(out.posts[0].permalink, null);
});

test('envelope, transport and malformed responses fail without quoting vendor messages', async () => {
    for (const response of [Response.json({ error: { code: 'invalid_token', message: 'private secret' } }),
        Response.json({ message: 'private secret' }, { status: 429 }), new Response('not json'), envelope({})]) {
        await assert.rejects(fetchAnalytics('token', account, async () => response), (err) => !err.message.includes('private secret') && err.message.startsWith('tiktok_'));
    }
});

test('repeated or malformed pagination cursors fail rather than retrying the same page', async () => {
    for (const cursor of [undefined, 'bad', -1, 1]) {
        let listCalls = 0;
        await assert.rejects(fetchAnalytics('token', account, async (url) => {
            if (new URL(url).pathname.includes('user/info')) return envelope(profile);
            listCalls++;
            return envelope({ videos: [], has_more: true, cursor });
        }), /invalid_cursor/);
        assert.ok(listCalls <= 2);
    }
});

test('refresh uses form credentials and returns the rotated token, actual scopes and identity', async () => {
    const result = await refreshAccessToken(cfg, 'old-refresh', async (url, init) => {
        assert.equal(url, 'https://open.tiktokapis.com/v2/oauth/token/');
        const params = new URLSearchParams(init.body);
        assert.equal(params.get('grant_type'), 'refresh_token');
        assert.equal(params.get('refresh_token'), 'old-refresh');
        assert.equal(params.get('client_secret'), cfg.clientSecret);
        return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', open_id: 'open-1', scope: 'user.info.basic,video.list', expires_in: 86400 });
    });
    assert.equal(result.refreshToken, 'new-refresh');
    assert.deepEqual(result.scopes, ['user.info.basic', 'video.list']);
    assert.equal(result.externalAccountId, 'open-1');
});

test('refresh rejects errors and incomplete replacement tokens without leaking upstream details', async () => {
    for (const body of [{ error: 'invalid_grant', error_description: 'private secret' }, { access_token: 'access-only' }]) {
        await assert.rejects(refreshAccessToken(cfg, 'refresh', async () => Response.json(body)), /tiktok_token_refresh_invalid_response/);
    }
});
