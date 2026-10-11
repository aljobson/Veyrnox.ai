import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublishSweep } from '../lib/socialPublishSweep.js';
import { encryptToken, tokenCryptoConfig } from '../lib/social/tokenCrypto.js';
import { verifyMediaProxyToken } from '../lib/social/mediaProxyToken.js';
import { networkReadiness } from '../lib/social/networkReadiness.js';
import { networkMedia } from '../lib/social/networks.js';
import { postCapabilityError } from '../lib/social/postCapabilities.js';
import { editorDestinations } from '../app/veyrnox/_lib/editorDelivery.mjs';
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service-test' };
const cryptoCfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
const r2cfg = { accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' };
const deps = { cfg, cryptoCfg, r2cfg, publicHost: 'https://veyrnox.test', mediaProxySecret: 'test-proxy', env: { PUBLISH_VIDEO_DESTINATIONS_ENABLED: 'true' } };
const started = new Date().toISOString();
async function target(network, provider_state = {}) {
    return { target_id: '11111111-1111-4111-8111-111111111111', claim_key: '22222222-2222-4222-8222-222222222222', account_id: '33333333-3333-4333-8333-333333333333', network,
        external_account_id: '123456', access_token_enc: await encryptToken('access-token', cryptoCfg), media_type: 'video', mime_type: 'video/mp4', size_bytes: 1000,
        r2_key: 'social-uploads/owner/render.mp4', global_text: 'Original edit', provider_state };
}
async function drive(row, handler, settings = deps, controls = {}) {
    const real = globalThis.fetch, order = []; let report, terminal, authorizations = 0;
    globalThis.fetch = async (url, init) => {
        const u = new URL(url), name = u.pathname.split('/').pop(); order.push(name);
        if (u.hostname !== 'db.test') return handler(u, init, order);
        const args = JSON.parse(init.body);
        if (name === 'authorize_social_target_dispatch') {
            if (args.p_target_id === '00000000-0000-0000-0000-000000000000') return Response.json({ ok: false, code: 'CLAIM_LOST' });
            authorizations++;
            assert.equal(args.p_claim_key, row.claim_key); assert.equal(args.p_target_id, row.target_id);
            const denied = controls.denyAuthorization || authorizations > (controls.allowAuthorizations ?? Infinity);
            return Response.json({ ok: !denied, code: denied ? 'MEDIA_HELD' : undefined });
        }
        if (name === 'claim_due_social_post_targets') return Response.json([row]);
        if (name === 'mark_social_provider_submission') { if (controls.denyMark) return Response.json(null); assert.equal(args.p_claim_key, row.claim_key); assert.equal(args.p_target_id, row.target_id); assert.equal(args.p_network, row.network); row.provider_state = { ...row.provider_state, submission_started: true }; return Response.json({ ok: true }); }
        if (name === 'report_social_post_progress') { if (controls.failReport) throw Error('checkpoint response lost'); assert.equal(args.p_claim_key, row.claim_key); report = args; return Response.json({ ok: true }); }
        if (name === 'complete_social_post_target') { assert.equal(args.p_claim_key, row.claim_key); terminal = args; return Response.json({ ok: true }); }
        throw Error('unexpected RPC');
    };
    try { const result = await runPublishSweep(settings); return { result, order, report, terminal }; } finally { globalThis.fetch = real; }
}

test('native video availability is derived from exact opt-in, released networks, connection and uploads', () => {
    for (const key of ['instagram', 'facebook', 'tiktok']) {
        for (const value of [undefined, 'false', 'TRUE', '1']) { const env = { PUBLISH_VIDEO_DESTINATIONS_ENABLED: value, PUBLISH_EXTENDED_NETWORKS_ENABLED: 'true' }; assert.deepEqual(networkMedia(key, env), ['image']); assert.equal(postCapabilityError([{ network: key }], [{ media_type: 'video' }], '', env), 'unsupported_media_type'); }
        const env = { PUBLISH_VIDEO_DESTINATIONS_ENABLED: 'true', PUBLISH_EXTENDED_NETWORKS_ENABLED: 'true', PUBLIC_HOST: 'https://veyrnox.test', SOCIAL_MEDIA_PROXY_SECRET: 'test-proxy' };
        assert.deepEqual(networkMedia(key, env), ['image', 'video']); assert.equal(postCapabilityError([{ network: key }], [{ media_type: 'video' }], '', env), null);
        assert.equal(postCapabilityError([{ network: key }], [{ media_type: 'video' }], '', { ...env, PUBLISH_RELEASED_NETWORKS: 'youtube' }), 'network_unavailable');
        for (const missing of [{ PUBLIC_HOST: undefined }, { PUBLIC_HOST: 'http://veyrnox.test' }, { PUBLIC_HOST: 'https://user:pass@veyrnox.test' }, { PUBLIC_HOST: 'https://veyrnox.test:123' }, { PUBLIC_HOST: 'https://veyrnox.test/#fragment' }, { SOCIAL_MEDIA_PROXY_SECRET: undefined }, { SOCIAL_MEDIA_PROXY_SECRET: ' ' }]) { const closed = { ...env, ...missing }; assert.deepEqual(networkMedia(key, closed), ['image']); assert.equal(postCapabilityError([{ network: key }], [{ media_type: 'video' }], '', closed), 'unsupported_media_type'); }
        const data = { uploadsEnabled: true, networks: [{ key, available: true, media: networkMedia(key, env) }], accounts: [{ network: key, status: 'active', publishingEnabled: true }] };
        assert.equal(editorDestinations(data).find(n => n.key === key).ready, true);
        assert.equal(editorDestinations({ ...data, networks: [{ key, available: true, media: ['image'] }] }).find(n => n.key === key).ready, false);
    }
    const ready = networkReadiness({ PUBLIC_HOST: 'https://veyrnox.test', SOCIAL_OAUTH_STATE_SECRET: 'state', SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), META_APP_ID: '123456', META_APP_SECRET: 's'.repeat(20) });
    assert.deepEqual(ready.find(n => n.key === 'instagram').media, ['image']); assert.deepEqual(networkMedia('youtube', {}), ['video']);
});

test('flag off and missing source/proxy contracts fail before any provider call', async () => {
    for (const key of ['instagram', 'facebook', 'tiktok']) {
        const row = await target(key);
        const result = await drive(row, () => assert.fail('disabled video contacted provider'), { ...deps, env: {} }); assert.equal(result.terminal.p_error, 'video_destinations_not_open');
        row.mime_type = 'video/webm'; assert.equal((await drive(row, () => assert.fail('bad MIME contacted provider'))).terminal.p_error, 'unsupported_video');
        row.mime_type = 'video/mp4'; assert.equal((await drive(row, () => assert.fail('unconfigured proxy contacted provider'), { ...deps, publicHost: 'http://veyrnox.test' })).terminal.p_error, 'media_proxy_not_configured');
    }
});

test('TikTok marks once before inbox initialization and checkpoints the verified owned proxy source', async () => {
    const row = await target('tiktok');
    const sent = await drive(row, async (u, init, order) => {
        assert.equal(order.at(-2), 'mark_social_provider_submission'); assert.equal(u.pathname, '/v2/post/publish/inbox/video/init/');
        const body = JSON.parse(init.body), proxy = new URL(body.source_info.video_url); assert.equal(proxy.origin, deps.publicHost);
        const token = proxy.pathname.split('/').pop(); assert.equal(await verifyMediaProxyToken(token, deps.mediaProxySecret), row.r2_key);
        const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()); assert.ok(payload.e - Date.now() / 1000 >= 3600);
        assert.deepEqual(Object.keys(body), ['source_info']); return Response.json({ data: { publish_id: 'video-publish:1' } });
    });
    assert.equal(sent.report.p_provider_state.publish_id, 'video-publish:1'); assert.equal(sent.report.p_provider_state.submission_started, true); assert.equal(sent.result.published, 0);
    row.provider_state = sent.report.p_provider_state;
    const complete = await drive(row, async u => { assert.equal(u.pathname, '/v2/post/publish/status/fetch/'); return Response.json({ data: { status: 'SEND_TO_USER_INBOX' } }); }, { ...deps, env: {} });
    assert.equal(complete.terminal.p_ok, true); assert.equal(complete.terminal.p_delivered, true); assert.equal(complete.terminal.p_platform_post_url, null);
});

test('TikTok ambiguous initial response or unknown persisted submission never creates another share', async () => {
    const row = await target('tiktok'); let initialCalls = 0;
    const first = await drive(row, async () => { initialCalls++; throw Error('network disconnected after accept'); }); assert.equal(first.result.failed, 1); assert.equal(row.provider_state.submission_started, true);
    const retried = await drive(row, () => assert.fail('duplicate inbox upload')); assert.equal(retried.terminal.p_error, 'provider_result_unknown_reconcile_before_retry'); assert.equal(initialCalls, 1);
});

test('Instagram and Facebook checkpoint/poll preserve live claim and never retry ambiguous public submissions', async () => {
    for (const key of ['instagram', 'facebook']) {
        const row = await target(key, key === 'instagram' ? { container_id: '111111', started_at: started } : {});
        let writes = 0;
        const first = await drive(row, async (_u, init) => { if (init.method !== 'POST') return Response.json({ status_code: 'FINISHED' }); writes++; throw Error('accepted response lost'); });
        assert.equal(first.result.failed, 1); assert.equal(row.provider_state.submission_started, true);
        const retry = await drive(row, () => assert.fail('duplicate public video')); assert.equal(retry.terminal.p_error, 'provider_result_unknown_reconcile_before_retry'); assert.equal(writes, 1);
    }
});

test('TikTok poll keeps progress distinct from failed, invalid and timed-out provider states', async () => {
    const row = await target('tiktok', { publish_id: 'video-publish:1', started_at: started, submission_started: true });
    assert.equal((await drive(row, async () => Response.json({ data: { status: 'PROCESSING_DOWNLOAD' } }))).report.p_provider_state.publish_id, 'video-publish:1');
    for (const [status, error] of [['FAILED', 'tiktok_video_failed'], ['unexpected', 'invalid_publish_status']]) assert.equal((await drive(row, async () => Response.json({ data: { status } }))).terminal.p_error, error);
    assert.equal((await drive(row, async () => Response.json({ error: { code: 'bad', message: 'private signed URL' } }))).terminal.p_error, 'tiktok_status_failed');
    row.provider_state.started_at = new Date(Date.now() - 3 * 3600000).toISOString(); assert.equal((await drive(row, () => assert.fail('expired poll'))).terminal.p_error, 'poll_timeout');
});


test('a refused submission fence prevents every irreversible video request', async () => {
    for (const key of ['instagram', 'facebook', 'tiktok']) {
        const row = await target(key, key === 'instagram' ? { container_id: '111111', started_at: started } : {});
        const result = await drive(row, async (_u, init) => { assert.notEqual(init.method, 'POST', 'lost claim made an irreversible request'); return Response.json({ status_code: 'FINISHED' }); }, deps, { denyMark: true });
        assert.equal(result.terminal.p_error, 'submission_claim_lost'); assert.equal(row.provider_state.submission_started, undefined);
    }
});

test('lost result checkpoints after accepted video submissions cannot cause duplicate posts or shares', async () => {
    for (const key of ['instagram', 'facebook', 'tiktok']) {
        const row = await target(key, key === 'instagram' ? { container_id: '111111', started_at: started } : {}); let posts = 0;
        const first = await drive(row, async (_u, init) => { if (init.method !== 'POST') return Response.json({ status_code: 'FINISHED' }); posts++; return Response.json(key === 'tiktok' ? { data: { publish_id: 'accepted-video' } } : { id: '333333' }); }, deps, { failReport: true });
        assert.equal(first.result.errors, 1); assert.equal(row.provider_state.submission_started, true);
        const retry = await drive(row, () => assert.fail('lost checkpoint retried provider submission')); assert.equal(retry.terminal.p_error, 'provider_result_unknown_reconcile_before_retry'); assert.equal(posts, 1);
    }
});


test('TikTok status polling also refuses redirects without forwarding the account token', async () => {
    const row = await target('tiktok', { publish_id: 'video-publish:1', started_at: started, submission_started: true }); let polls = 0;
    const result = await drive(row, async (_url, init) => { polls++; assert.equal(init.redirect, 'manual'); return new Response(null, { status: 302, headers: { location: 'https://attacker.test/token' } }); });
    assert.equal(polls, 1); assert.equal(result.terminal.p_error, 'tiktok_status_failed');
});

test('held native videos are deferred before sharing a source or recording a submission', async () => {
    const settings = { ...deps, env: { ...deps.env, SOCIAL_HOLD_CHECKS_ENABLED: 'true' } };
    for (const network of ['instagram', 'facebook', 'tiktok']) {
        const result = await drive(await target(network), () => assert.fail('held source reached provider'), settings, { denyAuthorization: true });
        assert.equal(result.result.deferred, 1); assert.equal(result.report, undefined); assert.equal(result.terminal, undefined);
        assert.deepEqual(result.order, ['authorize_social_target_dispatch', 'claim_due_social_post_targets', 'authorize_social_target_dispatch']);
    }
});

test('native video submission rechecks holds immediately before the marker and irreversible request', async () => {
    const settings = { ...deps, env: { ...deps.env, SOCIAL_HOLD_CHECKS_ENABLED: 'true' } };
    for (const network of ['instagram', 'facebook', 'tiktok']) {
        const row = await target(network, network === 'instagram' ? { container_id: '111111', started_at: started } : {});
        const result = await drive(row, async (_url, init) => {
            assert.notEqual(init.method, 'POST', 'held video made an irreversible request');
            return Response.json({ status_code: 'FINISHED' });
        }, settings, { allowAuthorizations: network === 'instagram' ? 0 : 1 });
        assert.equal(result.result.deferred, 1); assert.equal(result.terminal, undefined);
        assert.equal(result.order.includes('mark_social_provider_submission'), false);
        assert.equal(row.provider_state.submission_started, undefined);
    }
});

test('native video status reconciliation remains available while media is held', async () => {
    const settings = { ...deps, env: { ...deps.env, SOCIAL_HOLD_CHECKS_ENABLED: 'true' } };
    for (const [network, state, response] of [
        ['instagram', { post_id: '123456', submission_started: true }, { permalink: 'https://www.instagram.com/p/test/' }],
        ['facebook', { video_id: '123456', submission_started: true, started_at: started }, { status: { video_status: 'ready' } }],
        ['tiktok', { publish_id: 'accepted-video', submission_started: true, started_at: started }, { data: { status: 'SEND_TO_USER_INBOX' } }],
    ]) {
        const result = await drive(await target(network, state), async (_url, init) => {
            if (network !== 'tiktok') assert.notEqual(init.method, 'POST');
            return Response.json(response);
        }, settings, { denyAuthorization: true });
        assert.equal(result.terminal.p_ok, true); assert.equal(result.result.deferred, undefined);
        assert.equal(result.order.filter(name => name === 'authorize_social_target_dispatch').length, 1, 'only the availability probe is required for status reads');
        assert.equal(result.order.includes('mark_social_provider_submission'), false);
    }
});
