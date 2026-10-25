import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublishSweep } from '../lib/socialPublishSweep.js';
import { tokenCryptoConfig, encryptToken } from '../lib/social/tokenCrypto.js';

const cryptoCfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'fixture' };
const deps = { cfg, cryptoCfg, r2cfg: { accountId: 'fixture', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' },
    publicHost: 'https://veyrnox.ai', mediaProxySecret: 'fixture-proxy-secret', env: { SOCIAL_HOLD_CHECKS_ENABLED: 'true' } };
const zero = '00000000-0000-0000-0000-000000000000';

// Real sweep + encryption + TikTok adapter, but every transport is an explicit
// fixture. Marker persistence survives separate sweep invocations; no live calls.
async function fixture(options, run) {
    let persisted = options.state || {};
    const encrypted = await encryptToken('fixture-token', cryptoCfg);
    const calls = [], completions = [], progress = [];
    const previous = globalThis.fetch;
    let initCount = 0, polls = 0;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const name = u.pathname.split('/').filter(Boolean).pop();
        const body = JSON.parse(init.body);
        calls.push(name);
        if (u.hostname === 'db.test' && u.pathname.startsWith('/rest/v1/rpc/')) {
            if (name === 'authorize_social_target_dispatch') {
                return Response.json(body.p_target_id === zero ? { ok: false, code: 'CLAIM_LOST' }
                    : options.held ? { ok: false, code: 'MEDIA_HELD' } : { ok: true });
            }
            if (name === 'claim_due_social_post_targets_v2') return Response.json([{
                target_id: 'target-fixture', claim_key: 'claim-fixture', post_id: 'post-fixture', account_id: 'account-fixture',
                network: 'tiktok', access_token_enc: encrypted, external_account_id: 'fixture-open-id',
                media_type: 'image', mime_type: options.mime === undefined ? 'image/jpeg' : options.mime,
                r2_key: 'assets/fixture.jpg', global_text: 'Private draft QA', provider_state: persisted,
            }]);
            if (name === 'mark_social_provider_submission') {
                assert.deepEqual(body, { p_target_id: 'target-fixture', p_claim_key: 'claim-fixture', p_network: 'tiktok' });
                if (options.markRejected) return Response.json({ ok: false, code: 'CLAIM_LOST' });
                persisted = { ...persisted, submission_started: true };
                return Response.json({ ok: true });
            }
            if (name === 'report_social_post_progress') {
                progress.push(body);
                if (options.progressLost) return new Response('fixture-unavailable', { status: 503 });
                persisted = body.p_provider_state;
                return Response.json({ ok: true });
            }
            if (name === 'complete_social_post_target') { completions.push(body); return Response.json({ ok: true }); }
        }
        if (u.hostname === 'open.tiktokapis.com') {
            if (u.pathname === '/v2/post/publish/content/init/') {
                initCount++;
                assert.equal(body.media_type, 'PHOTO');
                assert.equal(body.post_mode, 'MEDIA_UPLOAD');
                assert.equal(body.is_aigc, true);
                assert.ok(body.source_info.photo_images[0].startsWith('https://veyrnox.ai/media/social/'));
                assert.equal(persisted.submission_started, true, 'persist before adapter sends anything');
                if (options.responseLost) throw new Error('fixture connection lost after provider accepted');
                return Response.json({ data: { publish_id: 'fixture-publish-id' } });
            }
            if (u.pathname === '/v2/post/publish/status/fetch/') {
                polls++;
                assert.equal(body.publish_id, 'fixture-publish-id');
                return Response.json({ data: { status: options.status || 'SEND_TO_USER_INBOX' } });
            }
        }
        throw new Error(`Unexpected mocked request: ${u.hostname}${u.pathname}`);
    };
    try { await run({ calls, completions, progress, snapshot: () => ({ persisted, initCount, polls }) }); }
    finally { globalThis.fetch = previous; }
}

for (const mode of ['responseLost', 'progressLost']) test(`TikTok photo ${mode}: persisted submission fence prevents a second init`, async () => {
    await fixture({ [mode]: true }, async (f) => {
        const first = await runPublishSweep(deps);
        assert.equal(mode === 'responseLost' ? first.failed : first.errors, 1);
        assert.equal(f.snapshot().persisted.submission_started, true);
        assert.equal(f.snapshot().persisted.publish_id, undefined);
        assert.equal((await runPublishSweep(deps)).failed, 1);
        assert.equal(f.snapshot().initCount, 1);
        assert.equal(f.completions.at(-1).p_error, 'provider_result_unknown_reconcile_before_retry');
        assert.equal(f.calls.filter((name) => name === 'mark_social_provider_submission').length, 1);
    });
});

test('TikTok photo marker rejection cannot call the provider', async () => {
    await fixture({ markRejected: true }, async (f) => {
        assert.equal((await runPublishSweep(deps)).failed, 1);
        assert.equal(f.snapshot().initCount, 0);
        assert.equal(f.completions[0].p_error, 'submission_claim_lost');
    });
});

test('TikTok photo normal initialization retains its fence and uses authorization immediately before marking', async () => {
    await fixture({}, async (f) => {
        assert.deepEqual(await runPublishSweep(deps), { ok: true, claimed: 1, published: 0, failed: 0, errors: 0 });
        assert.equal(f.progress[0].p_provider_state.submission_started, true);
        assert.equal(f.progress[0].p_provider_state.publish_id, 'fixture-publish-id');
        assert.deepEqual(f.calls, ['authorize_social_target_dispatch', 'claim_due_social_post_targets_v2',
            'authorize_social_target_dispatch', 'authorize_social_target_dispatch', 'mark_social_provider_submission', 'init', 'report_social_post_progress']);
    });
});

for (const status of ['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE']) test(`TikTok saved ID with fence polls ${status} as delivered, never public`, async () => {
    await fixture({ state: { submission_started: true, publish_id: 'fixture-publish-id', started_at: new Date().toISOString() }, status }, async (f) => {
        assert.equal((await runPublishSweep(deps)).errors, 0);
        assert.equal(f.snapshot().initCount, 0);
        assert.equal(f.snapshot().polls, 1);
        assert.equal(f.completions[0].p_delivered, true);
        assert.equal(f.completions[0].p_platform_post_url, null);
        assert.equal(f.calls.includes('mark_social_provider_submission'), false);
    });
});

test('TikTok processing status preserves the fence and saved publish ID', async () => {
    const state = { submission_started: true, publish_id: 'fixture-publish-id', started_at: new Date().toISOString() };
    await fixture({ state, status: 'PROCESSING_DOWNLOAD' }, async (f) => {
        await runPublishSweep(deps);
        assert.deepEqual(f.progress[0].p_provider_state, state);
        assert.equal(f.snapshot().initCount, 0);
    });
});

test('unsupported photo MIME never writes a submission marker or calls TikTok', async () => {
    await fixture({ mime: 'image/png' }, async (f) => {
        assert.equal((await runPublishSweep(deps)).failed, 1);
        assert.equal(f.snapshot().initCount, 0);
        assert.equal(f.calls.includes('mark_social_provider_submission'), false);
        assert.equal(f.completions[0].p_error, 'tiktok_photo_format_not_supported');
    });
});

test('held TikTok photo defers before marker or provider calls', async () => {
    await fixture({ held: true }, async (f) => {
        assert.equal((await runPublishSweep(deps)).deferred, 1);
        assert.equal(f.snapshot().initCount, 0);
        assert.equal(f.calls.includes('mark_social_provider_submission'), false);
        assert.equal(f.completions.length, 0);
    });
});
