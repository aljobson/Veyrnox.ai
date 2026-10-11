import { SOCIAL_NETWORKS, extendedNetworksEnabled, networkReleased, networkMedia } from './networks.js';
import { EXTENDED_ADAPTERS } from './extendedAdapters.js';
import { instagramConfig } from '../../packages/adapters/social/instagram.js';
import { linkedinConfig } from '../../packages/adapters/social/linkedin.js';
import { xConfig } from '../../packages/adapters/social/twitter.js';
import { tiktokConfig } from '../../packages/adapters/social/tiktok.js';
import { youtubeConfig } from '../../packages/adapters/social/youtube.js';
import { tokenCryptoConfig } from './tokenCrypto.js';
import { tiktokReviewAllowed } from './tiktokReview.js';
import { tiktokConnectionConfig } from './tiktokReviewTokens.js';

const CONFIGS = { instagram: instagramConfig, linkedin: linkedinConfig, twitter: xConfig, tiktok: tiktokConfig, youtube: youtubeConfig };
export function networkReadiness(env = process.env, authId) {
    let hostValid = false;
    try { const url = new URL(env.PUBLIC_HOST); hostValid = url.protocol === 'https:' && !url.username && !url.password; } catch { /* invalid deployment */ }
    const shared = Boolean(hostValid && env.SOCIAL_OAUTH_STATE_SECRET && tokenCryptoConfig(env));
    return SOCIAL_NETWORKS.map((network) => {
        const review = network.key === 'tiktok' && tiktokReviewAllowed(authId, env);
        const released = networkReleased(network.key, env) || review;
        const enabled = released && (!network.extended || extendedNetworksEnabled(env));
        const configured = shared && Boolean(review ? tiktokConnectionConfig(authId, env)
            : (CONFIGS[network.key] || EXTENDED_ADAPTERS[network.key].config)(env));
        return { ...network, media: networkMedia(network.key, env), available: enabled && configured, status: !released ? 'not_released' : !enabled ? 'testing_disabled' : !configured ? 'setup_required' : 'available' };
    });
}
