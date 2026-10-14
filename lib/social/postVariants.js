import { networkDetails } from './networks.js';

function textLength(network, value) {
    return network === 'bluesky'
        ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)].length
        : [...value].length;
}

/** Validate user-supplied platform copy before any database work. */
export function parsePostVariants(value, selectedNetworks) {
    if (value === undefined || value === null) return { variants: {} };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'invalid_network_text' };
    const entries = Object.entries(value);
    if (entries.length > 11) return { error: 'invalid_network_text' };
    const allowed = new Set(selectedNetworks);
    const variants = {};
    for (const [network, text] of entries) {
        const details = networkDetails(network);
        if (!allowed.has(network) || !details || typeof text !== 'string' || !text.trim()) return { error: 'invalid_network_text' };
        if (textLength(network, text) > details.captionLimit) return { error: 'caption_too_long' };
        variants[network] = text;
    }
    return { variants };
}

export function effectivePostText(network, globalText, variants = {}) {
    return variants[network] ?? globalText ?? '';
}
