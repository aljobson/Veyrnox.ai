function localDocument(uri: string): string | null {
    try {
        const url = new URL(uri);
        if (url.protocol !== 'file:' || url.host || url.username || url.password) return null;
        // Strip URL suffixes before decoding so an encoded '?' remains part of a filename.
        return decodeURIComponent(url.pathname);
    } catch { return null; }
}
function fragmentOf(uri: string): string | null {
    try { return new URL(uri).hash; } catch { return null; }
}
/**
 * Only the one bundled document may load, and with exactly the fragment its role allows: the hidden still-photo and 3D-wig views
 * must never load it with `#live` (that fragment is what lets the page open the camera), the camera view loads it with `#live`.
 * Every other URL, including an external web address, is rejected (and, with originWhitelist ['*'], never handed to the OS browser).
 */
export function allowsVisionNavigation(request: string, asset: string, fragment: '' | '#live' = ''): boolean {
    if (request === 'about:blank') return true;
    const expected = localDocument(asset);
    return expected !== null && localDocument(request) === expected && fragmentOf(request) === fragment;
}
