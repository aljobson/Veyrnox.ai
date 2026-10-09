import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTENDED_ADAPTERS as adapters } from '../lib/social/extendedAdapters.js';
import { postCapabilityError } from '../lib/social/postCapabilities.js';
import { networkReadiness } from '../lib/social/networkReadiness.js';
import { readImage } from '../packages/adapters/social/common.js';

const token = 'access-test';
const cfg = { clientId: 'client123', clientSecret: 'secret-test' };
const image = { externalAccountId: '12345', caption: 'Test post', mediaType: 'image', mediaUrl: 'https://media.test/photo.jpg' };
function sequence(steps) {
    const calls = [];
    const fetcher = async (url, init = {}) => {
        const step = steps.shift();
        assert.ok(step, `unexpected call ${new URL(url).pathname}`);
        calls.push({ url: new URL(url), init });
        step.check?.(calls.at(-1));
        return step.response || Response.json(step.body);
    };
    return { fetcher, calls, done: () => assert.equal(steps.length, 0) };
}

test('readiness exposes eleven networks but no credentials, with explicit flag and config gates', () => {
    const env = { PUBLIC_HOST: 'https://staging.test', SOCIAL_OAUTH_STATE_SECRET: 'state-secret',
        SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), PUBLISH_EXTENDED_NETWORKS_ENABLED: 'true',
        PINTEREST_CLIENT_ID: 'client123', PINTEREST_CLIENT_SECRET: 'secret-test' };
    const networks = networkReadiness(env);
    assert.equal(networks.length, 11);
    assert.equal(networks.find((n) => n.key === 'pinterest').available, true);
    assert.equal(networks.find((n) => n.key === 'facebook').status, 'setup_required');
    assert.equal(networks.find((n) => n.key === 'bluesky').available, true);
    assert.equal(networkReadiness({ ...env, PUBLISH_EXTENDED_NETWORKS_ENABLED: 'TRUE' }).find((n) => n.key === 'pinterest').status, 'testing_disabled');
    assert.equal(JSON.stringify(networks).includes('secret-test'), false);
    assert.equal(networkReadiness({ ...env, SOCIAL_TOKEN_ENCRYPTION_KEY: '' }).every((n) => !n.available), true);
});

test('each new OAuth URL binds state and uses its own registered HTTPS callback', () => {
    for (const network of ['facebook', 'threads', 'pinterest', 'twitch', 'gmb']) {
        const redirectUri = `https://staging.test/social/connect/callback/${network}`;
        const url = new URL(adapters[network].buildAuthorizeUrl(cfg, { state: 'state-test', redirectUri }));
        assert.equal(url.searchParams.get('state'), 'state-test');
        assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
        assert.equal(url.searchParams.get('response_type'), 'code');
        assert.equal(url.toString().includes(cfg.clientSecret), false);
        assert.throws(() => adapters[network].buildAuthorizeUrl(cfg, { state: 's', redirectUri: 'http://insecure.test' }));
    }
});

test('Facebook returns eligible Pages with Page tokens; pagination never follows arbitrary URLs', async () => {
    const { fetcher, done } = sequence([
        { body: { data: [{ id: '123', name: 'Page', access_token: 'page-token', tasks: ['CREATE_CONTENT'] },
            { id: '456', name: 'No posting permission', access_token: 'other', tasks: ['ANALYZE'] }], paging: { next: 'https://evil.test', cursors: { after: 'cursor' } } } },
        { check: ({ url }) => { assert.equal(url.hostname, 'graph.facebook.com'); assert.equal(url.searchParams.get('after'), 'cursor'); }, body: { data: [] } },
    ]);
    const pages = await adapters.facebook.fetchCandidates(token, fetcher);
    assert.equal(pages.length, 1); assert.equal(pages[0].accessToken, 'page-token'); done();
});

test('Facebook publishes an image on the selected Page, never a personal profile', async () => {
    const { fetcher, done } = sequence([{ check: ({ url, init }) => {
        assert.equal(url.pathname, '/v23.0/12345/photos');
        assert.equal(init.headers.Authorization, 'Bearer page-token');
        assert.equal(new URLSearchParams(init.body).get('url'), image.mediaUrl);
    }, body: { id: 'photo', post_id: '12345_67890' } }]);
    assert.equal((await adapters.facebook.publishPost('page-token', image, fetcher)).platformPostId, '12345_67890'); done();
    await assert.rejects(adapters.facebook.publishPost(token, { ...image, mediaType: 'video' }, fetcher), /unsupported_media_type/);
});

test('Pinterest lists only boards owned by the consenting account', async () => {
    const { fetcher, done } = sequence([
        { body: { username: 'Tester' } },
        { body: { items: [{ id: '123', name: 'Owned', owner: { username: 'tester' } }, { id: '456', name: 'Foreign', owner: { username: 'someone' } }] } },
    ]);
    assert.deepEqual((await adapters.pinterest.fetchCandidates(token, fetcher)).map((b) => b.externalAccountId), ['123']); done();
});

test('Pinterest token exchange uses Basic authorization and retains a refresh token when not reissued', async () => {
    const { fetcher, done } = sequence([{ check: ({ init }) => {
        assert.equal(init.headers.Authorization, `Basic ${btoa('client123:secret-test')}`);
        assert.equal(new URLSearchParams(init.body).get('grant_type'), 'refresh_token');
    }, body: { access_token: 'new-token', expires_in: 3600 } }]);
    const result = await adapters.pinterest.refreshAccessToken(cfg, 'old-refresh', fetcher);
    assert.equal(result.refreshToken, 'old-refresh'); assert.equal(result.accessToken, 'new-token'); done();
});

test('Pinterest pin creation includes the selected board and an image URL', async () => {
    const { fetcher, done } = sequence([{ check: ({ init }) => {
        const body = JSON.parse(init.body);
        assert.equal(body.board_id, '12345'); assert.deepEqual(body.media_source, { source_type: 'image_url', url: image.mediaUrl });
    }, body: { id: 'pin123' } }]);
    assert.equal((await adapters.pinterest.publishPost(token, image, fetcher)).platformPostUrl, 'https://www.pinterest.com/pin/pin123/'); done();
});

test('Threads persists a container, waits for processing, publishes once, then resolves the permalink', async () => {
    const { fetcher, done } = sequence([
        { body: { id: 'container' } }, { body: { status: 'IN_PROGRESS' } },
        { body: { status: 'FINISHED' } },
        { check: ({ init }) => assert.equal(new URLSearchParams(init.body).get('creation_id'), 'container'), body: { id: 'post' } },
        { body: { permalink: 'https://www.threads.net/@tester/post/abc' } },
    ]);
    const first = await adapters.threads.publishStep(token, image, fetcher);
    assert.equal(first.inProgress, true);
    const waiting = await adapters.threads.publishStep(token, { ...image, state: first.providerState }, fetcher);
    assert.equal(waiting.providerState.container_id, 'container');
    const submitted = await adapters.threads.publishStep(token, { ...image, state: waiting.providerState }, fetcher);
    assert.equal(submitted.providerState.post_id, 'post');
    const result = await adapters.threads.publishStep(token, { ...image, state: submitted.providerState }, fetcher);
    assert.equal(result.ok, true); assert.equal(result.platformPostId, 'post'); done();
});

test('Threads failed/expired containers never call the publish endpoint', async () => {
    for (const status of ['ERROR', 'EXPIRED', 'PUBLISHED']) {
        const { fetcher, done } = sequence([{ body: { status } }]);
        await assert.rejects(adapters.threads.publishStep(token, { ...image, state: { container_id: 'c', started_at: new Date().toISOString() } }, fetcher)); done();
    }
});

test('Google Business Profile discovers accessible locations and preserves their account parent', async () => {
    const { fetcher, done } = sequence([
        { body: { accounts: [{ name: 'accounts/123' }] } },
        { check: ({ url }) => assert.equal(url.searchParams.get('readMask'), 'name,title'), body: { locations: [{ name: 'locations/456', title: 'Test shop' }] } },
        { check: ({ url, init }) => { assert.equal(url.pathname, '/v4/accounts/123/locations/456/localPosts');
            assert.equal(JSON.parse(init.body).topicType, 'STANDARD'); }, body: { name: 'accounts/123/locations/456/localPosts/789', searchUrl: 'https://maps.google.com/test' } },
    ]);
    const [location] = await adapters.gmb.fetchCandidates(token, fetcher);
    assert.equal(location.externalAccountId, 'accounts/123/locations/456');
    assert.equal((await adapters.gmb.publishPost(token, { ...image, externalAccountId: location.externalAccountId }, fetcher)).platformPostId, 'accounts/123/locations/456/localPosts/789'); done();
});

test('Twitch validates the token client and user before returning video statistics', async () => {
    const { fetcher, done } = sequence([
        { body: { client_id: cfg.clientId, user_id: '123' } },
        { body: { data: [{ id: '123', display_name: 'Tester' }] } },
        { body: { data: [{ id: 'v123', title: 'Stream', url: 'https://www.twitch.tv/videos/123', created_at: '2026-10-08T12:00:00Z', view_count: 2 }] } },
    ]);
    const data = await adapters.twitch.fetchAnalytics(token, { externalAccountId: '123' }, fetcher, cfg);
    assert.equal(data.posts[0].metrics.views, 2); assert.equal(data.posts[0].type, 'video'); done();
    await assert.rejects(adapters.twitch.fetchCandidates(token, async () => Response.json({ client_id: 'foreign', user_id: '123' }), cfg), /account_mismatch/);
});

test('Business Profile processing is not published until Google reports LIVE; rejected posts fail', async () => {
    const name = 'accounts/123/locations/456/localPosts/789';
    for (const [state, expected] of [['PROCESSING', { processing: true }], ['REJECTED', { ok: false, error: 'google_post_rejected' }],
        ['LIVE', { ok: true, platformPostId: name, platformPostUrl: 'https://maps.google.com/test' }]]) {
        assert.deepEqual(await adapters.gmb.checkPost(token, name, async () => Response.json({ state, searchUrl: 'https://maps.google.com/test' })), expected);
    }
});

test('Bluesky rejects an attacker-supplied PDS from discovery before any credential forwarding', async () => {
    let calls = 0;
    await assert.rejects(adapters.bluesky.connect({ identifier: 'test.bsky.social', appPassword: 'aaaa-bbbb-cccc-dddd' }, async () => {
        calls++; return Response.json({ did: 'did:plc:tester', accessJwt: 'access', refreshJwt: 'refresh', didDoc: {
            id: 'did:plc:tester', service: [{ type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://attacker.test' }] } });
    }), /unsupported_bluesky_host/);
    assert.equal(calls, 1);
});

test('Bluesky upload uses an image blob and a stable target record key for retry safety', async () => {
    const targetId = '11111111-1111-4111-8111-111111111111';
    const { fetcher, done } = sequence([
        { response: new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/jpeg' } }) },
        { body: { blob: { $type: 'blob', ref: { $link: 'cid' }, mimeType: 'image/jpeg', size: 2 } } },
        { check: ({ url, init }) => {
            assert.equal(url.hostname, 'bsky.social'); assert.equal(url.pathname, '/xrpc/com.atproto.repo.putRecord');
            const body = JSON.parse(init.body); assert.equal(body.rkey, targetId.replaceAll('-', ''));
            assert.equal(body.record.embed.images[0].image.ref.$link, 'cid');
        }, body: { uri: `at://did:plc:tester/app.bsky.feed.post/${targetId.replaceAll('-', '')}` } },
    ]);
    const result = await adapters.bluesky.publishPost(JSON.stringify({ jwt: token, pds: 'https://bsky.social' }), { ...image, externalAccountId: 'did:plc:tester', targetId }, fetcher);
    assert.match(result.platformPostUrl, /bsky.app\/profile\/did%3Aplc%3Atester\/post\//); done();
});

test('image buffering is bounded even when the response omits Content-Length', async () => {
    await assert.rejects(readImage(image.mediaUrl, 2, async () => new Response(new Uint8Array(3), { headers: { 'Content-Type': 'image/jpeg' } })), /image_too_large/);
});

test('post capabilities reject Twitch uploads, disabled integrations, wrong media and long captions', () => {
    const env = { PUBLISH_EXTENDED_NETWORKS_ENABLED: 'true' };
    const media = [{ media_type: 'image' }];
    assert.equal(postCapabilityError([{ network: 'twitch' }], media, '', env), 'publishing_not_supported');
    assert.equal(postCapabilityError([{ network: 'pinterest' }], media, '', {}), 'network_unavailable');
    assert.equal(postCapabilityError([{ network: 'youtube' }], media, '', env), 'unsupported_media_type');
    assert.equal(postCapabilityError([{ network: 'threads' }], media, 'a'.repeat(501), env), 'caption_too_long');
    assert.equal(postCapabilityError([{ network: 'bluesky' }], media, '👨‍👩‍👧‍👦'.repeat(300), env), null);
    assert.equal(postCapabilityError([{ network: 'facebook' }, { network: 'pinterest' }], media, 'Test', env), null);
});

test('provider errors never echo secret-bearing bodies', async () => {
    const fail = async () => Response.json({ error: { message: 'secret-test access-token' } }, { status: 403 });
    await assert.rejects(adapters.facebook.publishPost(token, image, fail), (error) => !error.message.includes('secret-test') && error.message === 'provider_request_failed_403');
});
