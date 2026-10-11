import { rpc } from '../../packages/db/supabase-client.js';
import { instagramVideoStep, facebookVideoStep, submitTiktokVideo, videoProviderFetch } from '../../packages/adapters/social/videoPublishing.js';
import { checkPublishStatus } from '../../packages/adapters/social/tiktok.js';
import { createMediaProxyToken } from './mediaProxyToken.js';
import { nativeVideoEnabled } from './networks.js';

const nextCheck = () => new Date(Date.now() + 60000).toISOString();
async function mark(target, cfg) {
    if (target.provider_state?.submission_started) throw new Error('provider_result_unknown_reconcile_before_retry');
    const result = await rpc('mark_social_provider_submission', { p_target_id: target.target_id, p_claim_key: target.claim_key, p_network: target.network }, cfg);
    if (!result?.ok) throw new Error('submission_claim_lost');
}

// Claims supply actor-owned source keys. Nothing in a handoff URL selects a
// provider account or bypasses the existing explicit post/schedule request.
export async function dispatchNativeVideo(target, token, ctx) {
    const state = target.provider_state || {};
    if (!nativeVideoEnabled(ctx.env) && !state.post_id && !state.video_id && !state.publish_id) return { ok: false, error: 'video_destinations_not_open' };
    if (target.mime_type !== 'video/mp4' || !Number.isSafeInteger(Number(target.size_bytes)) || Number(target.size_bytes) < 1 || Number(target.size_bytes) > 100 * 1024 * 1024) return { ok: false, error: 'unsupported_video' };
    let host;
    try { host = new URL(ctx.publicHost); } catch { return { ok: false, error: 'media_proxy_not_configured' }; }
    if (host.protocol !== 'https:' || host.username || host.password || host.port || host.hash || typeof ctx.mediaProxySecret !== 'string' || !ctx.mediaProxySecret.trim()) return { ok: false, error: 'media_proxy_not_configured' };
    const authorize = ctx.authorizeDispatch || (async () => {});
    if (!state.container_id && !state.post_id && !state.video_id && !state.publish_id) await authorize();
    const beforePublish = async () => { await authorize(); await mark(target, ctx.cfg); };
    // Covers the bounded two-hour processing window and TikTok's full hour
    // to fetch the video after initialization. No redirect to an R2 host.
    const proxy = await createMediaProxyToken({ r2Key: target.r2_key, expiresInSeconds: 2 * 3600 + 60 }, ctx.mediaProxySecret);
    const mediaUrl = new URL(`/media/social/${proxy}`, host).toString();
    const input = { externalAccountId: target.external_account_id, caption: target.text_override || target.global_text || '', mediaType: 'video', mediaUrl, state };
    if (target.network === 'instagram') return instagramVideoStep(token, input, fetch, beforePublish);
    if (target.network === 'facebook') return facebookVideoStep(token, input, fetch, beforePublish);
    if (target.network !== 'tiktok') return { ok: false, error: 'network_not_implemented' };
    if (state.publish_id) {
        if (typeof state.publish_id !== 'string' || !/^[A-Za-z0-9_:.\-/]{1,200}$/.test(state.publish_id)) return { ok: false, error: 'invalid_publish_id' };
        const started = Date.parse(state.started_at || '');
        if (!Number.isFinite(started) || Date.now() - started > 2 * 60 * 60 * 1000 || started > Date.now() + 60000) return { ok: false, error: 'poll_timeout' };
        const status = await checkPublishStatus(token, state.publish_id, videoProviderFetch(fetch)).catch(() => { throw new Error('tiktok_status_failed'); });
        if (['PUBLISH_COMPLETE', 'SEND_TO_USER_INBOX'].includes(status.status)) return { ok: true, delivered: true, platformPostId: state.publish_id, platformPostUrl: null };
        if (status.status === 'FAILED') return { ok: false, error: 'tiktok_video_failed' };
        if (!['PROCESSING_DOWNLOAD', 'PROCESSING_UPLOAD', 'PROCESSING'].includes(status.status)) return { ok: false, error: 'invalid_publish_status' };
        return { inProgress: true, providerState: state, nextCheckAt: nextCheck() };
    }
    await beforePublish();
    const { publishId } = await submitTiktokVideo(token, input);
    return { inProgress: true, providerState: { submission_started: true, publish_id: publishId, started_at: new Date().toISOString() }, nextCheckAt: nextCheck() };
}
