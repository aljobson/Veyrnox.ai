/**
 * Supabase JWT verification primitives for the /api/v1 gateway.
 *
 * Pure Web Crypto, no `next/server` import, so `middleware.js` can use it in
 * the edge runtime and `tests/supabaseJwt.test.mjs` can exercise it under
 * plain Node with a stubbed `fetch`.
 *
 * Supabase signs with ES256 (asymmetric). We fetch the project's public JWKS
 * from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` once per hour and
 * verify with `crypto.subtle`. Never HS256, never a shared secret, never
 * `jose` (tripped Workers Builds, see CLAUDE.md).
 */

import { fetchWithTimeout } from './fetchWithTimeout.js';

// The JWKS endpoint sits on the critical path of every /api/v1 request, so it
// gets a deadline: a Supabase edge that accepts the connection and then stalls
// must not stall every signed-in user with it. Past the deadline loadJwks
// falls back to the cached key set, exactly as it does for a network error.
const JWKS_TIMEOUT_MS = 5000;

// Per-worker in-memory JWKS cache. The TTL is how long a key set is used
// before it is refetched, and therefore the window in which a key Supabase
// has REVOKED still verifies. It was 24 hours, on the reasoning that
// rotation is an operator action; but rotation is exactly what happens after
// a key is compromised, so an hour is the right order of magnitude. One
// fetch per worker per hour is nothing.
const JWKS_TTL_MS = 60 * 60 * 1000;
// ...but a cached key set is only served past its TTL for this long. Every
// fallback below was unbounded, so if the JWKS endpoint was down, 404ing, or
// returning junk, a key Supabase had REVOKED stayed trusted indefinitely —
// while a key it ADDED propagated in about a minute (the unknown-kid
// refresh). Past this ceiling a fetch failure is an outage, answered 503,
// rather than an open door (audit 2026-09-23).
export const JWKS_MAX_STALE_MS = 6 * 60 * 60 * 1000;
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

/**
 * The cached key set, if it is young enough to still stand in for a fetch
 * we could not make. Past JWKS_MAX_STALE_MS it is not: the caller gets a
 * 'jwks' failure, which middleware.js answers 503.
 */
function staleFallback(origin, why) {
    if (jwksCache?.origin === origin && Date.now() - jwksCache.fetchedAt < JWKS_MAX_STALE_MS) return jwksCache.byKid;
    if (jwksCache) console.error('[auth] cached JWKS is too old to trust; refusing to verify:', why);
    throw fail('jwks', why);
}

async function loadJwks(supabaseUrl, { force = false } = {}) {
    const now = Date.now();
    const origin = new URL(supabaseUrl).origin;
    if (jwksCache && jwksCache.origin !== origin) { jwksCache = null; lastMissRefreshAt = 0; }
    if (!force && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.byKid;
    let res;
    try {
        res = await fetchWithTimeout(
            new URL('/auth/v1/.well-known/jwks.json', supabaseUrl), {}, JWKS_TIMEOUT_MS);
    } catch (err) {
        // Serve the last good key set through a transient outage, but only
        // while it is young enough (staleFallback).
        return staleFallback(origin, `jwks fetch: ${err && err.message}`);
    }
    if (!res.ok) {
        return staleFallback(origin, `jwks ${res.status}`);
    }
    let jwks;
    try {
        jwks = await res.json();
    } catch (err) {
        return staleFallback(origin, `jwks parse: ${err && err.message}`);
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
        return staleFallback(origin, 'no usable jwks keys');
    }
    jwksCache = { origin, fetchedAt: now, byKid };
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
    const parts = typeof token === 'string' && token.length <= 16384 ? token.split('.') : [];
    if (parts.length !== 3) throw fail('malformed');
    const [h, p, s] = parts;

    let header;
    try { header = JSON.parse(b64UrlToUtf8(h)); } catch { throw fail('malformed', 'bad header'); }
    if (!header || typeof header !== 'object' || Array.isArray(header)) throw fail('malformed');
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
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return 'malformed';
    const expectedIssuer = new URL('/auth/v1', supabaseUrl).toString();
    if (claims.iss !== expectedIssuer) return 'issuer';
    const audMatch = claims.aud === 'authenticated'
        || (Array.isArray(claims.aud) && claims.aud.includes('authenticated'));
    if (!audMatch) return 'audience';
    if (!Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_SEC < nowSec) return 'expired';
    if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > nowSec + CLOCK_SKEW_SEC)) return 'malformed';
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
/** Tests only: pretend the cached key set was fetched `ms` ago. */
export function _ageJwksCache(ms) { if (jwksCache) jwksCache.fetchedAt -= ms; }

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
