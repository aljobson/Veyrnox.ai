import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublishSweep } from '../lib/socialPublishSweep.js';
import { tokenCryptoConfig, encryptToken } from '../lib/social/tokenCrypto.js';
import { verifyMediaProxyToken } from '../lib/social/mediaProxyToken.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service' };
const cryptoCfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
const deps = { cfg, cryptoCfg, r2cfg: { accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' },
    publicHost: 'https://veyrnox.test', mediaProxySecret: 'secret', env: { SOCIAL_HOLD_CHECKS_ENABLED: 'true', PUBLISH_VIDEO_DESTINATIONS_ENABLED: 'true' } };
const item = (media_type, position) => ({ position, media_type, r2_key: `assets/${position}`, mime_type: media_type === 'video' ? 'video/mp4' : 'image/jpeg', size_bytes: 1000 });

async function exercise(types, { invalid, loseResult = false, network = 'instagram', videoEnabled = true, state = {} } = {}) {
    const media = types.map(item);
    if (invalid) Object.assign(media[1], invalid);
    const target = { target_id: 't', post_id: 'p', account_id: 'a', network, claim_key: 'claim', external_account_id: '12345',
        access_token_enc: await encryptToken('token', cryptoCfg), token_expires_at: '2099-01-01T00:00:00Z', global_text: 'caption', media_type: media[0].media_type,
        r2_key: media[0].r2_key, mime_type: media[0].mime_type, size_bytes: media[0].size_bytes, media, provider_state: state };
    const real = globalThis.fetch;
    const created = [], completed = []; let marks = 0, publications = 0, lost = false;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(url), name = u.pathname.split('/').at(-1);
        if (u.hostname === 'db.test') {
            const body = JSON.parse(init.body);
            if (name === 'authorize_social_target_dispatch') return Response.json(body.p_target_id.startsWith('00000000') ? { ok: false, code: 'CLAIM_LOST' } : { ok: true });
            if (name === 'claim_due_social_post_targets_v2') return Response.json([target]);
            if (name === 'mark_social_provider_submission') { marks++; target.provider_state.submission_started = true; return Response.json({ ok: true }); }
            if (name === 'report_social_post_progress' || name === 'checkpoint_social_carousel') {
                if (loseResult && body.p_provider_state.post_id && !lost) { lost = true; throw new Error('lost_checkpoint'); }
                target.provider_state = body.p_provider_state; return Response.json({ ok: true });
            }
            if (name === 'complete_social_post_target') { if (loseResult && body.p_error?.includes('lost_checkpoint')) return Response.json({ ok: true }); completed.push(body); return Response.json({ ok: true }); }
            throw new Error(`unexpected_rpc_${name}`);
        }
        if (name.endsWith('_publish')) { publications++; assert.equal(marks, 1); return Response.json({ id: 'post' }); }
        if (init.method === 'POST') {
            const body = Object.fromEntries(new URLSearchParams(init.body));
            assert.notEqual(body.media_type, 'REELS', 'carousel routing precedes native video, even video-first');
            created.push(body); return Response.json({ id: `c${created.length}` });
        }
        return Response.json({ status_code: 'FINISHED', status: 'FINISHED', permalink: 'https://post.test/carousel' });
    };
    try {
        for (let tick = 0; tick < 16 && !completed.length; tick++) await runPublishSweep({ ...deps, env: { ...deps.env, PUBLISH_VIDEO_DESTINATIONS_ENABLED: String(videoEnabled) } });
        assert.equal(completed.length, 1);
        return { created, completed, publications, marks };
    } finally { globalThis.fetch = real; }
}

for (const types of [['image', 'image'], ['video', 'image'], ['image', 'video'], ['video', 'video']]) {
    test(`Instagram ${types.join('-')} continues children and parent without dropping or duplicating an item`, async () => {
        const result = await exercise(types);
        assert.equal(result.publications, 1); assert.equal(result.completed[0].p_ok, true);
        assert.equal(result.created.length, types.length + 1);
        for (const [index, child] of result.created.slice(0, -1).entries()) {
            const url = new URL(child.image_url || child.video_url);
            const verified = await verifyMediaProxyToken(decodeURIComponent(url.pathname.split('/').at(-1)), deps.mediaProxySecret);
            assert.equal(verified, `assets/${index}`);
        }
    });
}
test('lost final checkpoint retains the durable mark and refuses another public submission', async () => {
    for (const network of ['instagram', 'threads']) {
        const result = await exercise(['image', 'image'], { loseResult: true, network });
        assert.equal(result.publications, 1); assert.equal(result.marks, 1);
        assert.equal(result.completed[0].p_error, 'provider_result_unknown_reconcile_before_retry');
    }
});
test('bad metadata on any later item fails the target before any provider request', async () => {
    for (const invalid of [{ r2_key: null }, { mime_type: 'image/gif' }, { size_bytes: null }]) {
        const result = await exercise(['image', 'image'], { invalid });
        assert.equal(result.publications, 0); assert.equal(result.created.length, 0); assert.equal(result.marks, 0);
        assert.equal(result.completed[0].p_ok, false);
    }
});
test('disabled native video rejects a fresh carousel but permits in-flight continuation', async () => {
    const fresh = await exercise(['image', 'video'], { videoEnabled: false });
    assert.equal(fresh.completed[0].p_error, 'video_destinations_not_open');
    assert.equal(fresh.created.length, 0); assert.equal(fresh.marks, 0);
    const continuing = await exercise(['video', 'image'], { videoEnabled: false,
        state: { children: [{ id: 'saved-child', ready: true }], started_at: new Date().toISOString() } });
    assert.equal(continuing.completed[0].p_ok, true); assert.equal(continuing.publications, 1);
});
test('only a missing v2 RPC falls back to the legacy claim, then dispatches a single post', async () => {
    const real = globalThis.fetch;
    try {
        for (const code of ['PGRST202', '42501']) {
            const names = [];
            globalThis.fetch = async (url, init) => {
                const name = new URL(url).pathname.split('/').at(-1); names.push(name);
                if (name === 'claim_due_social_post_targets_v2') return Response.json({ code }, { status: 404 });
                if (name === 'claim_due_social_post_targets') return Response.json([{ target_id: 'single', network: 'instagram', media_type: 'image', r2_key: 'one', access_token_enc: await encryptToken('token', cryptoCfg), external_account_id: '123', provider_state: { submission_started: true } }]);
                if (name === 'complete_social_post_target') { assert.equal(JSON.parse(init.body).p_target_id, 'single'); return Response.json({ ok: true }); }
                throw new Error(`unexpected_${name}`);
            };
            const result = await runPublishSweep({ ...deps, env: {} });
            assert.equal(names.includes('claim_due_social_post_targets'), code === 'PGRST202');
            assert.equal(result.claimed, code === 'PGRST202' ? 1 : undefined);
        }
    } finally { globalThis.fetch = real; }
});
