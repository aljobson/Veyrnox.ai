import test from 'node:test';
import assert from 'node:assert/strict';
import { publishCarouselStep as instagram } from '../packages/adapters/social/instagram.js';
import { publishCarouselStep as threads } from '../packages/adapters/social/threads.js';
import { publishPost as linkedin } from '../packages/adapters/social/linkedin.js';
import { publishPost as twitter } from '../packages/adapters/social/twitter.js';
import { publishPost as facebook } from '../packages/adapters/social/facebook.js';
import { publishPost as bluesky } from '../packages/adapters/social/bluesky.js';
import { submitMediaUploadPost as tiktok } from '../packages/adapters/social/tiktok.js';

const media = [{ mediaType: 'image', mediaUrl: 'https://media.test/a.jpg' }, { mediaType: 'image', mediaUrl: 'https://media.test/b.jpg' }];
const input = { media, mediaType: 'image', externalAccountId: '12345', caption: 'caption' };
for (const [name, step] of [['instagram', instagram], ['threads', threads]]) {
    test(`${name}: ten children finish within three five-minute ticks, with durable crash recovery`, async t => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-25T12:00:00Z') });
        const start = Date.now(), created = new Map();
        let state = {}, publishes = 0, crashed = false;
        const checkpoint = async value => {
            state = structuredClone(value);
            if (!crashed && state.children.length === 1 && !state.creating) { crashed = true; throw new Error('crash_after_checkpoint'); }
        };
        const fake = async (url, init = {}) => {
            const id = new URL(url).pathname.split('/').at(-1);
            if (id.endsWith('_publish')) { publishes++; return Response.json({ id: 'post' }); }
            if (init.method === 'POST') {
                const id = `c${created.size}`; created.set(id, Date.now()); return Response.json({ id });
            }
            if (id === 'post') return Response.json({ permalink: 'https://post.test/carousel' });
            const status = Date.now() - created.get(id) >= 300000 ? 'FINISHED' : 'IN_PROGRESS';
            return Response.json({ status, status_code: status });
        };
        const run = () => step('token', { ...input, media: Array.from({ length: 10 }, () => media[0]), state,
            checkpoint, wait: async ms => t.mock.timers.tick(ms) }, fake, async () => { state.submission_started = true; });
        await assert.rejects(run(), /crash_after_checkpoint/);
        let result = await run();
        assert.equal(created.size, 10, 'all children created in the first tick, no duplicate after crash');
        for (let tick = 0; result.inProgress && tick < 3; tick++) { t.mock.timers.tick(300000); result = await run(); }
        assert.equal(result.ok, true); assert.equal(created.size, 11); assert.equal(publishes, 1);
        assert.ok(Date.now() - start < 16 * 60000, 'well inside the two-hour timeout');
        await run(); assert.equal(publishes, 1); assert.equal(created.size, 11);
    });
    test(`${name}: lost child response or failed ID checkpoint never recreates the child`, async () => {
        for (const loseResponse of [true, false]) {
            let state = {}, creates = 0;
            const checkpoint = async value => {
                if (!loseResponse && value.children.length) throw new Error('checkpoint_lost');
                state = structuredClone(value);
            };
            const fake = async () => { creates++; if (loseResponse) throw new Error('response_lost'); return Response.json({ id: 'child' }); };
            await assert.rejects(step('token', { ...input, state, checkpoint }, fake), /lost/);
            await assert.rejects(step('token', { ...input, state, checkpoint }, fake), /container_result_unknown_reconcile/);
            assert.equal(creates, 1);
        }
    });
}
for (const [name, step] of [['instagram', instagram], ['threads', threads]]) {
    test(`${name} checkpoints ordered children and parent; only one final publish`, async () => {
        let state = {}, creates = [], publications = 0, marks = 0;
        const fake = async (url, init = {}) => {
            const path = new URL(url).pathname;
            if (path.endsWith('_publish')) { publications++; assert.equal(marks, 1); return Response.json({ id: 'posted' }); }
            if (init.method === 'POST') { creates.push(Object.fromEntries(new URLSearchParams(init.body))); return Response.json({ id: `c${creates.length}` }); }
            if (path.endsWith('/posted')) return Response.json({ permalink: 'https://post.test/1' });
            return Response.json({ status: 'FINISHED', status_code: 'FINISHED' });
        };
        let result;
        for (let tick = 0; tick < 10; tick++) {
            result = await step('token', { ...input, state, checkpoint: async value => { state = value; } }, fake, async () => { marks++; });
            if (!result.inProgress) break;
            state = JSON.parse(JSON.stringify(result.providerState));
        }
        assert.equal(result.ok, true); assert.equal(publications, 1); assert.equal(marks, 1);
        assert.deepEqual(creates.map(c => c.image_url).filter(Boolean), media.map(m => m.mediaUrl));
        assert.equal(creates[2].media_type, 'CAROUSEL'); assert.equal(creates[2].children, 'c1,c2');
        assert.equal(creates[0].is_carousel_item, 'true');
        await step('token', { ...input, state, checkpoint: async value => { state = value; } }, fake, async () => { marks++; });
        assert.equal(publications, 1);
    });
    test(`${name} poll preserves child ids; ambiguous publish is never resubmitted`, async () => {
        const state = { started_at: new Date().toISOString(), children: [{ id: 'first', ready: false }, { id: 'second', ready: false }] };
        const waiting = await step('token', { ...input, state, checkpoint: async () => {}, wait: async () => {} }, async () => Response.json({ status: 'IN_PROGRESS', status_code: 'IN_PROGRESS' }));
        assert.deepEqual(waiting.providerState, state);
        const ready = { ...state, children: [{ id: 'first', ready: true }, { id: 'second', ready: true }], container_id: 'parent' };
        let posted = 0, marked = false;
        const fake = async (_url, init = {}) => { if (init.method === 'POST') { posted++; throw new Error('lost_response'); } return Response.json({ status: 'FINISHED', status_code: 'FINISHED' }); };
        await assert.rejects(step('token', { ...input, state: ready, checkpoint: async () => {} }, fake, async () => { marked = true; }), /lost_response/);
        assert.equal(marked, true);
        await assert.rejects(step('token', { ...input, state: { ...ready, submission_started: true }, checkpoint: async () => {} }, fake), /reconcile_before_retry/);
        assert.equal(posted, 1);
    });
}
test('LinkedIn uploads each image and publishes ordered MultiImage content', async () => {
    let n = 0, marked = false, body;
    await linkedin('token', input, async (url, init = {}) => {
        if (url.includes('initializeUpload')) return Response.json({ value: { uploadUrl: 'https://upload.test/image', image: `urn:li:image:${++n}` } });
        if (url.startsWith('https://media.test')) return new Response('bytes', { headers: { 'Content-Type': 'image/jpeg' } });
        if (url.includes('/rest/posts')) { assert.equal(marked, true); body = JSON.parse(init.body); return new Response(null, { status: 201, headers: { 'x-restli-id': 'post' } }); }
        return new Response(null, { status: 201 });
    }, async () => { marked = true; });
    assert.deepEqual(body.content.multiImage.images, [{ id: 'urn:li:image:1' }, { id: 'urn:li:image:2' }]);
});
test('X uploads each photo and publishes the ordered media ids once', async () => {
    let n = 0, marks = 0, body;
    await twitter('token', input, async (url, init = {}) => {
        if (url.startsWith('https://media.test')) return new Response('bytes', { headers: { 'Content-Type': 'image/jpeg' } });
        if (url.endsWith('/initialize')) return Response.json({ data: { id: `${++n}` } });
        if (url.endsWith('/tweets')) { assert.equal(marks, 1); body = JSON.parse(init.body); return Response.json({ data: { id: 'post' } }); }
        return Response.json({ data: {} });
    }, async () => { marks++; });
    assert.deepEqual(body.media.media_ids, ['1', '2']);
});
test('Facebook prepares unpublished photos then attaches every id to one feed post', async () => {
    let n = 0, marks = 0, attached;
    await facebook('token', input, async (url, init) => {
        const body = new URLSearchParams(init.body);
        if (url.endsWith('/photos')) { assert.equal(body.get('published'), 'false'); return Response.json({ id: `${++n}` }); }
        assert.equal(marks, 1); attached = JSON.parse(body.get('attached_media')); return Response.json({ id: 'post' });
    }, async () => { marks++; });
    assert.deepEqual(attached, [{ media_fbid: '1' }, { media_fbid: '2' }]);
});
test('Bluesky embeds every uploaded blob and TikTok delivers every photo to the inbox', async () => {
    let n = 0, body;
    await bluesky(JSON.stringify({ jwt: 'jwt', pds: 'https://bsky.social' }), { ...input, targetId: '11111111-1111-4111-8111-111111111111' }, async (url, init = {}) => {
        if (url.startsWith('https://media.test')) return new Response('bytes', { headers: { 'content-type': 'image/jpeg' } });
        if (url.endsWith('uploadBlob')) return Response.json({ blob: { ref: `${++n}` } });
        body = JSON.parse(init.body); return Response.json({ uri: 'post' });
    });
    assert.deepEqual(body.record.embed.images.map(i => i.image.ref), ['1', '2']);
    await tiktok('token', { photoUrls: media.map(m => m.mediaUrl), caption: 'caption' }, async (_url, init) => {
        body = JSON.parse(init.body); return Response.json({ error: { code: 'ok' }, data: { publish_id: 'publish' } });
    });
    assert.deepEqual(body.source_info.photo_images, media.map(m => m.mediaUrl));
    assert.equal(body.post_mode, 'MEDIA_UPLOAD');
});
