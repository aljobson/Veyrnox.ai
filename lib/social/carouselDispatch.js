import { rpc } from '../../packages/db/supabase-client.js';
import { networkDetails, nativeVideoEnabled } from './networks.js';
import { createMediaProxyToken } from './mediaProxyToken.js';
import { presignGetUrl } from '../../packages/adapters/r2.js';
import { publishCarouselStep as instagram } from '../../packages/adapters/social/instagram.js';
import { publishCarouselStep as threads } from '../../packages/adapters/social/threads.js';

const IMAGE_FORMATS = {
    instagram: ['image/jpeg'], linkedin: ['image/jpeg', 'image/png'], twitter: ['image/jpeg', 'image/png', 'image/webp'],
    tiktok: ['image/jpeg', 'image/webp'], threads: ['image/jpeg', 'image/png'],
    facebook: ['image/jpeg', 'image/png', 'image/webp'], bluesky: ['image/jpeg', 'image/png', 'image/webp'],
};
const IMAGE_MAX = { instagram: 8 * 1024 * 1024, threads: 8 * 1024 * 1024, twitter: 5 * 1024 * 1024, bluesky: 1000000 };

export function carouselMediaError(network, media) {
    const capability = networkDetails(network)?.carousel;
    if (!Array.isArray(media) || !capability || media.length < capability.min || media.length > capability.max) return 'media_count_not_supported';
    for (let index = 0; index < media.length; index++) {
        const item = media[index];
        if (!item || item.position !== index || !item.r2_key || typeof item.r2_key !== 'string') return 'missing_media';
        const size = Number(item.size_bytes);
        if (!Number.isSafeInteger(size) || size < 1 || !capability.types.includes(item.media_type)) return 'invalid_media';
        if (item.media_type === 'video') {
            if (item.mime_type !== 'video/mp4' || size > 100 * 1024 * 1024) return 'unsupported_video';
        } else if (!IMAGE_FORMATS[network]?.includes(item.mime_type) || size > (IMAGE_MAX[network] || 20 * 1024 * 1024)) return 'unsupported_image';
    }
    return null;
}

export async function dispatchCarousel(target, accessToken, ctx, handler, authorize, mark) {
    const invalid = carouselMediaError(target.network, target.media);
    if (invalid) return { ok: false, error: invalid };
    const state = target.provider_state || {};
    const inFlight = state.children?.length || state.creating || state.container_id || state.post_id || state.submission_started;
    if (target.media.some(item => item.media_type === 'video') && !nativeVideoEnabled(ctx.env) && !inFlight) {
        return { ok: false, error: 'video_destinations_not_open' };
    }
    await authorize();
    const proxyNetwork = ['instagram', 'threads', 'tiktok'].includes(target.network);
    let host;
    if (proxyNetwork) {
        try { host = new URL(ctx.publicHost); } catch { return { ok: false, error: 'media_proxy_not_configured' }; }
        if (host.protocol !== 'https:' || host.username || host.password || host.port || host.hash || !ctx.mediaProxySecret?.trim()) return { ok: false, error: 'media_proxy_not_configured' };
    }
    const media = [];
    for (const item of target.media) {
        // Sign every owned object. Meta/TikTok pull through the stable signed
        // proxy for their bounded two-hour processing window (ADR-0262).
        const { url } = await presignGetUrl(item.r2_key, 900, ctx.r2cfg);
        let mediaUrl = url;
        if (proxyNetwork) {
            const token = await createMediaProxyToken({ r2Key: item.r2_key, expiresInSeconds: 2 * 3600 + 60 }, ctx.mediaProxySecret);
            mediaUrl = new URL(`/media/social/${token}`, host).toString();
        }
        media.push({ mediaType: item.media_type, mediaUrl, mimeType: item.mime_type, sizeBytes: item.size_bytes });
    }
    if (target.network === 'instagram' || target.network === 'threads') {
        return (target.network === 'instagram' ? instagram : threads)(accessToken, {
            externalAccountId: target.external_account_id, caption: target.text_override || target.global_text || '',
            media, state,
            checkpoint: async providerState => {
                const result = await rpc('checkpoint_social_carousel', { p_target_id: target.target_id,
                    p_claim_key: target.claim_key, p_provider_state: providerState }, ctx.cfg);
                if (!result?.ok) throw new Error('carousel_checkpoint_claim_lost');
            },
        }, fetch, mark);
    }
    return handler({ ...target, carouselMedia: media }, accessToken, media[0].mediaUrl, ctx);
}
