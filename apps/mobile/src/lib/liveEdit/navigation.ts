function localDocument(uri: string): string | null {
    try {
        const url = new URL(uri);
        if (url.protocol !== 'file:' || url.host || url.username || url.password) return null;
        // Strip URL suffixes before decoding so an encoded '?' remains part of a filename.
        return decodeURIComponent(url.pathname);
    } catch { return null; }
}
export function allowsVisionNavigation(request: string, asset: string): boolean {
    if (request === 'about:blank') return true;
    const expected = localDocument(asset);
    return expected !== null && localDocument(request) === expected;
}
