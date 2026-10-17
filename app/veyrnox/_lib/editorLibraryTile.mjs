const BADGES = Object.freeze({ device: 'This device', editor: 'Saved edit', master: 'Film Studio' });
const SYMBOLS = Object.freeze({ video: '▶', audio: '♪', image: '▣' });

export const libraryBadge = source => BADGES[source] || 'Generated';

const safeLink = url => (typeof url === 'string' && url.startsWith('https://') ? url : null);

/** What one Library tile shows. The preview link is the short-lived one fetched while listing; it is never stored. */
export function libraryTile(item) {
    const url = safeLink(item.previewUrl);
    return {
        name: `${item.kind}: ${item.label} · ${libraryBadge(item.source)}`,
        badge: libraryBadge(item.source),
        symbol: SYMBOLS[item.kind] || SYMBOLS.image,
        preview: url && (item.kind === 'image' || item.kind === 'video') ? { type: item.kind, url } : null,
    };
}
