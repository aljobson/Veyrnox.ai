import { networkDetails } from './networks.js';

export const mediaIdentity = item => item.uploadId ? `upload:${item.uploadId}` : `job:${item.jobId}`;
export const orderedMediaSignature = items => items.map(item => [mediaIdentity(item), item.mediaType]);

export function selectionLimit(accounts, enabled) {
    if (!enabled) return 1;
    return Math.min(10, ...accounts.map(account => networkDetails(account.network)?.carousel?.max || 1));
}

export function selectionBlocker(accounts, items, enabled) {
    if (items.length <= 1) return null;
    if (!enabled) return { error: 'carousel_not_open' };
    for (const account of accounts) {
        const network = networkDetails(account.network);
        const carousel = network?.carousel;
        if (!carousel || items.length > carousel.max || items.some(item => !carousel.types.includes(item.mediaType)
            || !(account.supportedMedia || network.media).includes(item.mediaType))) {
            return { error: 'media_count_not_supported', network: account.network };
        }
    }
    return null;
}

export function toggleMedia(items, item, max) {
    const id = mediaIdentity(item);
    if (items.some(existing => mediaIdentity(existing) === id)) return items.filter(existing => mediaIdentity(existing) !== id);
    if (max === 1) return [item];
    return items.length < max ? [...items, item] : items;
}

export function moveMedia(items, index, direction) {
    const to = index + direction;
    if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items;
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
}
