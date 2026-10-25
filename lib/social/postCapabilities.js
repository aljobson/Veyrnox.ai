import { networkDetails, networkEnabled, networkMedia } from './networks.js';
import { tiktokReviewAllowed } from './tiktokReview.js';
import { effectivePostText } from './postVariants.js';

export const carouselEnabled = (env = process.env) => env.PUBLISH_CAROUSEL_ENABLED === 'true';

// All writers call this same admission rule; a single attachment keeps its legacy path.
export function carouselAdmission(accounts, media, env = process.env) {
    if (!Array.isArray(media) || media.length <= 1) return null;
    if (!carouselEnabled(env)) return { error: 'carousel_not_open' };
    for (const account of accounts) {
        const carousel = networkDetails(account.network)?.carousel;
        const supported = account.supportedMedia || networkMedia(account.network, env);
        if (!carousel || media.length < carousel.min || media.length > carousel.max
            || media.some(item => !carousel.types.includes(item?.media_type ?? item?.mediaType)
                || !supported.includes(item?.media_type ?? item?.mediaType))) {
            return { error: 'media_count_not_supported', network: account.network };
        }
    }
    return null;
}

export function postCapabilityError(accounts, media, caption, env = process.env, authId, networkText = {}) {
    const admission = carouselAdmission(accounts, media, env);
    if (admission) return admission.error;
    for (const account of accounts) {
        const network = networkDetails(account.network);
        if (!networkEnabled(account.network, env)
            && !(account.network === 'tiktok' && tiktokReviewAllowed(authId, env))) return 'network_unavailable';
        if (!network.media.length) return 'publishing_not_supported';
        if (!media.length || media.some(item => !networkMedia(account.network, env).includes(item.media_type))) return 'unsupported_media_type';
        const text = effectivePostText(account.network, caption, networkText);
        const length = account.network === 'bluesky'
            ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length
            : [...text].length;
        if (length > network.captionLimit) return 'caption_too_long';
    }
    return null;
}
