import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramVideoStep, facebookVideoStep, submitTiktokVideo } from '../packages/adapters/social/videoPublishing.js';
const now = Date.now(), start = new Date(now).toISOString();
const input = { externalAccountId: '123456', mediaType: 'video', mediaUrl: 'https://veyrnox.test/media/social/owned', caption: 'Original edit', now };
const respond = data => Response.json(data);

test('Instagram checkpoints an actual REELS container, polls and marks immediately before publishing', async () => {
    const calls = []; let state = {};
    const fetcher = async (url, init) => {
        const u = new URL(url); calls.push(u.pathname); assert.equal(u.hostname, 'graph.instagram.com'); assert.equal(init.redirect, 'manual'); assert.equal(init.headers.Authorization, 'Bearer ig-token');
        if (u.pathname.endsWith('/media')) { const body = new URLSearchParams(init.body); assert.equal(body.get('media_type'), 'REELS'); assert.equal(body.get('video_url'), input.mediaUrl); assert.equal(body.get('caption'), input.caption); return respond({ id: '111111' }); }
        if (u.pathname.endsWith('/media_publish')) { assert.equal(calls.at(-2), 'mark'); assert.equal(new URLSearchParams(init.body).get('creation_id'), '111111'); return respond({ id: '222222' }); }
        if (u.searchParams.get('fields') === 'status_code') return respond({ status_code: 'FINISHED' });
        return respond({ permalink: 'https://www.instagram.com/reel/original/' });
    };
    let step = await instagramVideoStep('ig-token', { ...input, state }, fetcher); state = step.providerState;
    assert.equal(state.container_id, '111111'); assert.equal(step.inProgress, true); assert.equal(state.started_at, start);
    step = await instagramVideoStep('ig-token', { ...input, state }, fetcher, async () => calls.push('mark')); state = step.providerState;
    assert.equal(state.post_id, '222222'); assert.equal(state.submission_started, true);
    const settled = await instagramVideoStep('ig-token', { ...input, state }, fetcher);
    assert.deepEqual(settled, { ok: true, platformPostId: '222222', platformPostUrl: 'https://www.instagram.com/reel/original/' });
    assert.equal(calls.filter(c => c.endsWith('/media')).length, 1); assert.equal(calls.filter(c => c.endsWith('/media_publish')).length, 1);
});

test('Instagram processing, terminal failures and refusal to re-publish unknown results', async () => {
    const state = { container_id: '111111', started_at: start }; let posts = 0;
    for (const status of ['IN_PROGRESS', 'ERROR', 'EXPIRED', 'PUBLISHED', 'unexpected']) {
        const fetcher = async (_url, init) => { if (init.method === 'POST') posts++; return respond({ status_code: status }); };
        const work = instagramVideoStep('token', { ...input, state }, fetcher);
        if (status === 'IN_PROGRESS') assert.deepEqual((await work).providerState, state); else await assert.rejects(work);
    }
    assert.equal(posts, 0);
    for (const bad of [{ ...state, submission_started: true }, { ...state, started_at: 'bad' }, { ...state, started_at: new Date(now - 3 * 3600000).toISOString() }, { ...state, container_id: '../../private' }]) await assert.rejects(instagramVideoStep('token', { ...input, state: bad }, () => assert.fail('invalid continuation contacted provider')));
    await assert.rejects(instagramVideoStep('token', { ...input, state }, async (_url, init) => { assert.notEqual(init.method, 'POST'); return respond({ status_code: 'FINISHED' }); }, async () => { throw Error('claim lost'); }), /claim lost/);
});

test('Instagram accepted post ID remains confirmed if permalink fails; untrusted URLs are omitted', async () => {
    for (const fetcher of [async () => { throw Error('offline'); }, async () => respond({ permalink: 'https://attacker.test/post' })]) assert.deepEqual(await instagramVideoStep('token', { ...input, state: { post_id: '222222' } }, fetcher), { ok: true, platformPostId: '222222', platformPostUrl: null });
});

test('Facebook marks before the published Page video request then polls the saved ID until ready', async () => {
    const order = []; let step, status = 'processing';
    const fetcher = async (url, init) => {
        const u = new URL(url); assert.equal(u.hostname, 'graph.facebook.com'); assert.equal(init.redirect, 'manual'); assert.equal(init.headers.Authorization, 'Bearer page-token');
        if (init.method === 'POST') { order.push('upload'); const body = new URLSearchParams(init.body); assert.equal(body.get('file_url'), input.mediaUrl); assert.equal(body.get('description'), input.caption); assert.equal(body.get('published'), 'true'); return respond({ id: '333333' }); }
        assert.equal(u.searchParams.get('fields'), 'status,permalink_url'); order.push('poll'); return respond({ status: { video_status: status } });
    };
    step = await facebookVideoStep('page-token', input, fetcher, async () => order.push('mark'));
    assert.deepEqual(order, ['mark', 'upload']); assert.equal(step.providerState.video_id, '333333');
    let saved = step.providerState; step = await facebookVideoStep('page-token', { ...input, state: saved }, fetcher);
    assert.equal(step.inProgress, true); assert.deepEqual(step.providerState, saved);
    status = 'ready'; step = await facebookVideoStep('page-token', { ...input, state: saved }, fetcher);
    assert.deepEqual(step, { ok: true, platformPostId: '333333', platformPostUrl: 'https://www.facebook.com/123456/videos/333333/' });
    assert.equal(order.filter(x => x === 'upload').length, 1);
});

test('Facebook ambiguous submissions, invalid continuations and provider failures never trigger another upload', async () => {
    await assert.rejects(facebookVideoStep('token', { ...input, state: { submission_started: true } }, () => assert.fail('resubmitted uncertain video')), /reconcile_before_retry/);
    for (const status of ['error', 'unknown', undefined]) await assert.rejects(facebookVideoStep('token', { ...input, state: { video_id: '333333', started_at: start } }, async (_url, init) => { assert.notEqual(init.method, 'POST'); return respond({ status: { video_status: status } }); }));
    await assert.rejects(facebookVideoStep('token', input, () => assert.fail('lost claim uploaded'), async () => { throw Error('claim lost'); }), /claim lost/);
    for (const data of [{ id: '../host' }, { id: '333333', error: { message: 'private signed URL' } }]) await assert.rejects(facebookVideoStep('token', input, async () => respond(data)), error => !error.message.includes('private signed URL'));
});

test('TikTok video uses only the documented video.upload inbox source envelope and sanitized errors', async () => {
    let sent;
    assert.deepEqual(await submitTiktokVideo('token', input, async (url, init) => { sent = { url, init }; return respond({ data: { publish_id: 'video-publish:1' }, error: { code: 'ok' } }); }), { publishId: 'video-publish:1' });
    assert.equal(sent.url, 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/'); assert.equal(sent.init.headers.Authorization, 'Bearer token'); assert.equal(sent.init.redirect, 'manual');
    assert.deepEqual(JSON.parse(sent.init.body), { source_info: { source: 'PULL_FROM_URL', video_url: input.mediaUrl } });
    for (const data of [{ data: {}, error: { code: 'url_ownership_unverified', message: 'private media URL' } }, { data: { publish_id: 'bad?token=private' } }, null]) await assert.rejects(submitTiktokVideo('token', input, async () => respond(data)), error => !error.message.includes('private'));
});

test('all new adapters refuse unsupported media, malformed IDs and unsafe media URLs before contacting providers', async () => {
    for (const run of [instagramVideoStep, facebookVideoStep, submitTiktokVideo]) for (const change of [{ mediaType: 'image' }, { mediaUrl: 'http://veyrnox.test/video' }, { mediaUrl: 'https://user:secret@veyrnox.test/video' }, { mediaUrl: 'https://veyrnox.test:444/video' }, { mediaUrl: 'file:///private' }]) await assert.rejects(run('token', { ...input, ...change }, () => assert.fail('unsafe input contacted provider')));
    for (const run of [instagramVideoStep, facebookVideoStep]) await assert.rejects(run('token', { ...input, externalAccountId: '../../other' }, () => assert.fail('bad account contacted provider')));
});


test('native video transport uses Worker-compatible manual redirects and never follows a provider redirect', async () => {
    for (const run of [instagramVideoStep, facebookVideoStep, submitTiktokVideo]) {
        let count = 0;
        await assert.rejects(run('secret-token', input, async (_url, init) => { count++; assert.equal(init.redirect, 'manual'); return new Response(null, { status: 307, headers: { location: 'https://attacker.test/secret' } }); }), /provider_redirect_rejected/);
        assert.equal(count, 1);
    }
});
