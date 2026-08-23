// Shared cutoff for the unprefixed legacy `muapi_key` cookie. After this
// instant only the `__Host-muapi_key` cookie is accepted across every proxy
// route. Baked as a fixed timestamp so the fallback cannot linger across
// redeploys and every proxy enforces the same deadline.
export const LEGACY_COOKIE_CUTOFF_MS = Date.UTC(2026, 7, 23); // 2026-08-23 UTC

const HOST_COOKIE_NAME = '__Host-muapi_key';
const LEGACY_COOKIE_NAME = 'muapi_key';

export function isLegacyCookieAllowed(now = Date.now()) {
    return now < LEGACY_COOKIE_CUTOFF_MS;
}

// Accepts a NextRequest-style object (`request.cookies.get(name).value`) or
// any object exposing a `cookies.get(name)` returning `{ value }`.
export function getApiKeyFromCookies(request) {
    const hostCookie = request.cookies.get(HOST_COOKIE_NAME)?.value;
    if (hostCookie) return hostCookie;
    if (!isLegacyCookieAllowed()) return undefined;
    return request.cookies.get(LEGACY_COOKIE_NAME)?.value;
}

// Accepts a Next.js RSC cookie store (from `await cookies()`), which exposes
// `.get(name)` directly. Wraps it to match the request-shape helper so RSCs
// and proxy routes enforce the same legacy cutoff.
export function getApiKeyFromCookieStore(cookieStore) {
    return getApiKeyFromCookies({ cookies: cookieStore });
}
