// Reads the MuAPI session key from the `__Host-muapi_key` cookie.
// The `__Host-` prefix pins the cookie to the exact origin (Secure + Path=/
// + no Domain), so it cannot leak across subdomains or be set by a MITM.
// Legacy unprefixed cookies are no longer accepted (cutoff was 2026-08-23).
const HOST_COOKIE_NAME = '__Host-muapi_key';

// Accepts a NextRequest-style object (`request.cookies.get(name).value`) or
// any object exposing a `cookies.get(name)` returning `{ value }`.
export function getApiKeyFromCookies(request) {
    return request.cookies.get(HOST_COOKIE_NAME)?.value;
}

// Accepts a Next.js RSC cookie store (from `await cookies()`), which exposes
// `.get(name)` directly. Wraps it to match the request-shape helper.
export function getApiKeyFromCookieStore(cookieStore) {
    return getApiKeyFromCookies({ cookies: cookieStore });
}
