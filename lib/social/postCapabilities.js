import { networkDetails, networkEnabled } from './networks.js';

export function postCapabilityError(accounts, media, caption, env = process.env) {
    for (const account of accounts) {
        const network = networkDetails(account.network);
        if (!networkEnabled(account.network, env)) return 'network_unavailable';
        if (!network.media.length) return 'publishing_not_supported';
        if (media.length !== 1 || !network.media.includes(media[0].media_type)) return 'unsupported_media_type';
        const length = account.network === 'bluesky'
            ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(caption || '')].length
            : [...(caption || '')].length;
        if (length > network.captionLimit) return 'caption_too_long';
    }
    return null;
}
