/**
 * Supabase JWT verification primitives for the /api/v1 gateway.
 *
 * Pure Web Crypto, no `next/server` import, so `middleware.js` can use it in
 * the edge runtime and `tests/supabaseJwt.test.mjs` can exercise it under
 * plain Node with a stubbed `fetch`.
 *
 * Supabase signs with ES256 (asymmetric). We fetch the project's public JWKS
 * from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` once per 24h and
 * verify with `crypto.subtle`. Never HS256, never a shared secret, never
 * `jose` (tripped Workers Builds, see CLAUDE.md).
 */

// Per-worker in-memory JWKS cache. 24h TTL is enough — Supabase docs
// don't guarantee rotation frequency but signing keys are rotated by
// operator action, not on a schedule.
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
// An unknown `kid` triggers at most one JWKS refresh per this window per
// worker, so unauthenticated junk tokens cannot turn into a fetch flood.
export const JWKS_MISS_REFRESH_MS = 60 * 1000;
let jwksCache = null; // { fetchedAt, byKid: Map<string, CryptoKey> }
let lastMissRefreshAt = 0;

export const CLOCK_SKEW_SEC = 5;

function fail(reason, msg) {
    const e = new Error(msg || reason);
    e.reason = reason;
    return e;
}

async function loadJwks(supabaseUrl, { force = false } = {}) {
    const now = Date.now();
    if (!force && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.byKid;
    let res;
    try {
        res = await fetch(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
    } catch (err) {
        // Keep serving the last good key set through a transient outage.
        if (jwksCache) return jwksCache.byKid;
        throw fail('jwks', `jwks fetch: ${err && err.message}`);
    }
    if (!res.ok) {
        if (jwksCache) return jwksCache.byKid;
        throw fail('jwks', `jwks ${res.status}`);
    }
    let jwks;
    try {
        jwks = await res.json();
    } catch (err) {
        // A 2xx with a non-JSON body (challenge page, truncated response) is
        // an upstream fault, not a credential fault: same fallback as above.
        if (jwksCache) return jwksCache.byKid;
        throw fail('jwks', `jwks parse: ${err && err.message}`);
    }
    const byKid = new Map();
    for (const jwk of (jwks && jwks.keys) || []) {
        if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.kid) continue;
        try {
            const key = await crypto.subtle.importKey(
                'jwk',
                { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
                { name: 'ECDSA', namedCurve: 'P-256' },
                false,
                ['verify'],
            );
            byKid.set(jwk.kid, key);
        } catch {
            // skip unusable
        }
    }
    if (byKid.size === 0) {
        if (jwksCache) return jwksCache.byKid;
        throw fail('jwks', 'no usable jwks keys');
    }
    jwksCache = { fetchedAt: now, byKid };
    return byKid;
}

/**
 * Verify the ES256 signature of a compact JWS and return its payload.
 * Throws an Error with `.reason` in {'malformed','signature','jwks'}.
 * 'jwks' means the key set could not be fetched and nothing is cached —
 * an outage on our side, not a bad credential. Does NOT check claims —
 * see validateClaims.
 */
export async function verifyES256(token, supabaseUrl) {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw fail('malformed');
    const [h, p, s] = parts;

    let header;
    try { header = JSON.parse(b64UrlToUtf8(h)); } catch { throw fail('malformed', 'bad header'); }
    if (header.alg !== 'ES256') throw fail('signature', 'alg');
    if (!header.kid) throw fail('signature', 'kid');

    const keys = await loadJwks(supabaseUrl);
    let key = keys.get(header.kid);
    if (!key) {
        // Cache miss — refresh at most once per JWKS_MISS_REFRESH_MS so a
        // stream of junk kids cannot drive a JWKS fetch per request. The old
        // key map is only replaced on a successful fetch.
        const now = Date.now();
        if (now - lastMissRefreshAt >= JWKS_MISS_REFRESH_MS) {
            lastMissRefreshAt = now;
            const refreshed = await loadJwks(supabaseUrl, { force: true });
            key = refreshed.get(header.kid);
        }
        if (!key) throw fail('signature', 'unknown kid');
    }

    // ES256 signature over JWS: 64 raw bytes (r||s), NOT DER.
    let sigBytes;
    try { sigBytes = b64UrlToBytes(s); } catch { throw fail('malformed', 'sig b64'); }
    if (sigBytes.length !== 64) throw fail('signature', 'sig len');

    const signingInput = new TextEncoder().encode(`${h}.${p}`);
    const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        key,
        sigBytes,
        signingInput,
    );
    if (!valid) throw fail('signature', 'bad sig');

    try { return JSON.parse(b64UrlToUtf8(p)); } catch { throw fail('malformed', 'bad payload'); }
}

/**
 * Standard-claim checks. Returns null when the claims are acceptable,
 * otherwise a reason string:
 * 'issuer' | 'audience' | 'expired' | 'malformed' | 'anonymous'.
 */
export function validateClaims(claims, supabaseUrl, nowSec = Math.floor(Date.now() / 1000)) {
    if (!claims || typeof claims !== 'object') return 'malformed';
    const expectedIssuer = new URL('/auth/v1', supabaseUrl).toString();
    if (claims.iss !== expectedIssuer) return 'issuer';
    const audMatch = claims.aud === 'authenticated'
        || (Array.isArray(claims.aud) && claims.aud.includes('authenticated'));
    if (!audMatch) return 'audience';
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SEC < nowSec) return 'expired';
    if (typeof claims.sub !== 'string' || !claims.sub) return 'malformed';
    // Anonymous sign-ins carry aud=authenticated but no identity; the money
    // spine (signup grant, generations) is for identified users only.
    if (claims.is_anonymous === true) return 'anonymous';
    return null;
}

/**
 * Bearer only. The client keeps the session in localStorage and never sets
 * a cookie; accepting one here would be an ambient-credential path with no
 * CSRF defence (CLAUDE.md: "we're Bearer-only"). Returns null when absent.
 */
export function readToken(req) {
    const bearer = req.headers.get('authorization');
    if (bearer && bearer.toLowerCase().startsWith('bearer ')) {
        return bearer.slice(7).trim() || null;
    }
    return null;
}

/** Test-only: drop the cached JWKS and the miss-refresh throttle. */
export function _resetJwksCache() { jwksCache = null; lastMissRefreshAt = 0; }

// ─── helpers ────────────────────────────────────────────────────────────────

function b64UrlToBytes(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function b64UrlToUtf8(s) { return new TextDecoder('utf-8', { fatal: true }).decode(b64UrlToBytes(s)); }
