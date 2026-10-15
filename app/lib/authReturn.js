/** A same-origin path suitable for an auth callback, or null. */
export function safeAuthReturnPath(value) {
    if (typeof value !== 'string' || !value.startsWith('/')) return null;
    try {
        const base = new URL('https://veyrnox.invalid/');
        const resolved = new URL(value, base);
        if (resolved.origin !== base.origin) return null;
        return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {
        return null;
    }
}

export function authCallbackUrl(returnTo, origin) {
    const path = safeAuthReturnPath(returnTo);
    if (!path) return undefined;
    const callback = new URL('/auth/callback', origin);
    callback.searchParams.set('next', path);
    return callback.toString();
}
