import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const { POST } = await import('../app/api/v1/social/posts/route.js');
const { GET } = await import('../app/api/v1/social/accounts/route.js');
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLISH_ENABLED: 'true', PUBLISH_UPLOADS_ENABLED: 'true', PUBLISH_EXTENDED_NETWORKS_ENABLED: 'true', PUBLIC_HOST: 'https://veyrnox.test', SOCIAL_MEDIA_PROXY_SECRET: 'test-proxy' });
const auth = '11111111-1111-4111-8111-111111111111', brand = '22222222-2222-4222-8222-222222222222', account = '33333333-3333-4333-8333-333333333333', upload = '44444444-4444-4444-8444-444444444444';
const body = { publishNow: true, globalText: 'Original render', idempotencyKey: 'editor-video-choice', accountIds: [account], media: [{ mediaType: 'video', uploadId: upload }] };
const request = (data = body, actor = auth) => new Request('https://veyrnox.test/api/v1/social/posts', { method: 'POST', headers: { 'x-veyrnox-auth-id': actor, 'content-type': 'application/json' }, body: JSON.stringify(data) });
let calls, network, selected, result;
function stub() {
    calls = []; selected = account; result = { ok: true, post_id: 'saved-post', target_count: 1 };
    globalThis.fetch = async (url, init) => {
        assert.equal(new URL(url).hostname, 'db.test', 'API preparation never sends to a provider'); const name = new URL(url).pathname.split('/').pop(), args = JSON.parse(init.body); calls.push({ name, args });
        if (name.startsWith('consume_')) return Response.json({ ok: true });
        if (name === 'get_or_create_default_social_brand') { assert.equal(args.p_auth_id, auth); return Response.json({ ok: true, brand_id: brand }); }
        if (name === 'list_social_accounts') return Response.json({ ok: true, accounts: [{ id: selected, network, status: 'active' }] });
        if (name === 'create_social_post') { assert.equal(args.p_auth_id, auth); assert.equal(args.p_brand_id, brand); assert.deepEqual(args.p_account_ids, [account]); assert.deepEqual(args.p_media, [{ media_type: 'video', upload_id: upload }]); return Response.json(result); }
        throw Error('unexpected RPC');
    };
}

test('video POST rejects unreleased media before creation and forwards only actor-owned IDs when enabled', async () => {
    for (network of ['instagram', 'facebook', 'tiktok']) {
        process.env.PUBLISH_VIDEO_DESTINATIONS_ENABLED = 'false'; stub();
        assert.equal((await POST(request())).status, 400); assert.equal(calls.some(c => c.name === 'create_social_post'), false);
        process.env.PUBLISH_VIDEO_DESTINATIONS_ENABLED = 'true'; stub();
        const res = await POST(request()); assert.equal(res.status, 201); assert.equal(calls.at(-1).name, 'create_social_post');
        stub(); selected = upload; assert.equal((await POST(request())).status, 404); assert.equal(calls.some(c => c.name === 'create_social_post'), false);
        stub(); result = { ok: false, code: 'MEDIA_NOT_FOUND' }; assert.equal((await POST(request())).status, 404);
    }
});

test('browser capabilities retain images while video opt-in is off and cannot be overridden by headers', async () => {
    network = 'instagram';
    for (const value of ['true', 'false', 'TRUE']) {
        process.env.PUBLISH_VIDEO_DESTINATIONS_ENABLED = value; stub();
        const data = await (await GET(new Request('https://veyrnox.test/api/v1/social/accounts', { headers: { 'x-veyrnox-auth-id': auth, 'x-video-enabled': 'true' } }))).json();
        assert.deepEqual(data.accounts[0].supportedMedia, value === 'true' ? ['image', 'video'] : ['image']);
        assert.deepEqual(data.networks.find(n => n.key === network).media, value === 'true' ? ['image', 'video'] : ['image']);
    }
});

test('malformed actor, media identifiers and upload gate cannot create native video posts', async () => {
    process.env.PUBLISH_VIDEO_DESTINATIONS_ENABLED = 'true'; network = 'tiktok'; stub();
    assert.equal((await POST(request(body, 'bad'))).status, 401); assert.equal(calls.length, 0);
    for (const media of [[{ mediaType: 'video', uploadId: '../other' }], [{ mediaType: 'video', uploadId: upload, jobId: upload }]]) { stub(); assert.equal((await POST(request({ ...body, media }))).status, 400); assert.equal(calls.length, 0); }
    process.env.PUBLISH_UPLOADS_ENABLED = 'false'; stub(); assert.equal((await POST(request())).status, 400); assert.equal(calls.length, 0);
});

test('missing proxy setup hides video capabilities and rejects preparation before persistence', async () => {
    process.env.PUBLISH_VIDEO_DESTINATIONS_ENABLED = 'true'; process.env.PUBLISH_UPLOADS_ENABLED = 'true'; network = 'instagram';
    for (const value of ['', ' ']) { process.env.SOCIAL_MEDIA_PROXY_SECRET = value; stub(); assert.equal((await POST(request())).status, 400); assert.equal(calls.some(c => c.name === 'create_social_post'), false);
        stub(); const data = await (await GET(new Request('https://veyrnox.test/api/v1/social/accounts', { headers: { 'x-veyrnox-auth-id': auth } }))).json(); assert.deepEqual(data.accounts[0].supportedMedia, ['image']); assert.deepEqual(data.networks.find(n => n.key === network).media, ['image']); assert.ok(!JSON.stringify(data).includes('test-proxy')); }
    process.env.SOCIAL_MEDIA_PROXY_SECRET = 'test-proxy';
});
