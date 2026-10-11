import { networkDetails, networkEnabled, networkMedia } from './networks.js';
import { tiktokReviewAllowed } from './tiktokReview.js';

export function postCapabilityError(accounts, media, caption, env = process.env, authId) {
    for (const account of accounts) {
        const network = networkDetails(account.network);
        if (!networkEnabled(account.network, env)
            && !(account.network === 'tiktok' && tiktokReviewAllowed(authId, env))) return 'network_unavailable';
        if (!network.media.length) return 'publishing_not_supported';
        if (media.length !== 1 || !networkMedia(account.network, env).includes(media[0].media_type)) return 'unsupported_media_type';
        const length = account.network === 'bluesky'
            ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(caption || '')].length
            : [...(caption || '')].length;
        if (length > network.captionLimit) return 'caption_too_long';
    }
    return null;
}
