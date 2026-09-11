/**
 * Root Next.js middleware — gates /api/v1/* on a verified Supabase JWT.
 *
 * Modern Supabase projects use ES256 (asymmetric) signing keys, not the
 * legacy HS256 shared secret. We fetch the project's public JWKS from
 * `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` once per 24h and verify
 * with Web Crypto — no shared secret, no jose (Slice 3b bisect), no
 * heavy libs (Workers Builds trip risk).
 *
 * Downstream route handlers read `x-veyrnox-auth-id` (set here after
 * verification) to identify the caller.
 *
 * NOT wired at the studio proxy paths (`/api/agents/*`, `/api/workflow/*`,
 * `/api/app/*`, `/api/upload-binary`, `/api/session/*`) which still use
 * the legacy `__Host-muapi_key` cookie until the 2026-10-10 sunset.
 *
 * Runtime env:
 *   SUPABASE_URL   e.g. https://<ref>.supabase.co  (required)
 * Without it the middleware fail-closes with 503 — a misconfigured
 * deployment must not accept traffic.
 */

import { NextResponse } from 'next/server';

export const config = {
    matcher: ['/api/v1/:path*'],
};

// Per-worker in-memory JWKS cache. 24h TTL is enough — Supabase docs
// don't guarantee rotation frequency but signing keys are rotated by
// operator action, not on a schedule.
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
// An unknown `kid` triggers at most one JWKS refresh per this window per
// worker, so unauthenticated junk tokens cannot turn into a fetch flood.
const JWKS_MISS_REFRESH_MS = 60 * 1000;
let jwksCache = null; // { fetchedAt, byKid: Map<string, CryptoKey> }
let lastMissRefreshAt = 0;

// Identity headers set by this middleware and trusted by /api/v1 handlers.
const IDENTITY_HEADERS = ['x-veyrnox-auth-id', 'x-veyrnox-auth-email', 'x-veyrnox-auth-role'];

// Retired legacy Muapi passthrough routes — let their handlers reply with
// the honest 410 + Sunset header instead of an intermediate 401.
const DEPRECATED_PREFIXES = [
    '/api/v1/get_upload_url',
    '/api/v1/creative-agent',
];

export async function middleware(req) {
    const path = new URL(req.url).pathname;
    // Identity headers are ours to set. Strip any inbound copy on EVERY
    // branch, including the deprecated passthrough, so no handler can ever
    // read a client-supplied value.
    const headers = new Headers(req.headers);
    for (const h of IDENTITY_HEADERS) headers.delete(h);

    for (const prefix of DEPRECATED_PREFIXES) {
        if (path === prefix || path.startsWith(prefix + '/')) {
            return NextResponse.next({ request: { headers } }); // handler replies 410
        }
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
        return jsonError(503, { error: 'auth not configured' });
    }

    const token = readToken(req);
    if (!token) return jsonError(401, { error: 'unauthorized', reason: 'missing' });

    let claims;
    try {
        claims = await verifyES256(token, supabaseUrl);
    } catch (err) {
        const reason = (err && err.reason) || 'signature';
        // A JWKS outage is our problem, not the caller's credentials:
        // 503 so clients do not bounce users to sign-in during an incident.
        if (reason === 'jwks') return jsonError(503, { error: 'auth_unavailable' });
        return jsonError(401, { error: 'unauthorized', reason });
    }

    // Standard-claim checks (verifyES256 already checked the signature).
    const expectedIssuer = new URL('/auth/v1', supabaseUrl).toString();
    if (claims.iss !== expectedIssuer) {
        return jsonError(401, { error: 'unauthorized', reason: 'issuer' });
    }
    const audMatch = claims.aud === 'authenticated'
        || (Array.isArray(claims.aud) && claims.aud.includes('authenticated'));
    if (!audMatch) return jsonError(401, { error: 'unauthorized', reason: 'audience' });
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp + 5 < nowSec) {
        return jsonError(401, { error: 'unauthorized', reason: 'expired' });
    }
    if (typeof claims.sub !== 'string' || !claims.sub) {
        return jsonError(401, { error: 'unauthorized', reason: 'malformed' });
    }
    // Anonymous sign-ins carry aud=authenticated but no identity; the money
    // spine (signup grant, generations) is for identified users only.
    if (claims.is_anonymous === true) {
        return jsonError(401, { error: 'unauthorized', reason: 'anonymous' });
    }

    // Forward verified identity (inbound copies were deleted above).
    headers.set('x-veyrnox-auth-id', claims.sub);
    if (claims.email) headers.set('x-veyrnox-auth-email', String(claims.email));
    if (claims.role) headers.set('x-veyrnox-auth-role', String(claims.role));

    return NextResponse.next({ request: { headers } });
}

// ─── ES256 verification via Web Crypto ─────────────────────────────────────

async function loadJwks(supabaseUrl, { force = false } = {}) {
    const now = Date.now();
    if (!force && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.byKid;
    let res;
    try {
        res = await fetch(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
    } catch (err) {
        // Keep serving the last good key set through a transient outage.
        if (jwksCache) return jwksCache.byKid;
        const e = new Error(`jwks fetch: ${err && err.message}`); e.reason = 'jwks'; throw e;
    }
    if (!res.ok) {
        if (jwksCache) return jwksCache.byKid;
        const e = new Error(`jwks ${res.status}`); e.reason = 'jwks'; throw e;
    }
    const jwks = await res.json();
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
        const e = new Error('no usable jwks keys'); e.reason = 'jwks'; throw e;
    }
    jwksCache = { fetchedAt: now, byKid };
    return byKid;
}

async function verifyES256(token, supabaseUrl) {
    const parts = token.split('.');
    if (parts.length !== 3) { const e = new Error('malformed'); e.reason = 'malformed'; throw e; }
    const [h, p, s] = parts;

    let header;
    try { header = JSON.parse(b64UrlToUtf8(h)); } catch { const e = new Error('bad header'); e.reason = 'malformed'; throw e; }
    if (header.alg !== 'ES256') { const e = new Error('alg'); e.reason = 'signature'; throw e; }
    if (!header.kid) { const e = new Error('kid'); e.reason = 'signature'; throw e; }

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
        if (!key) { const e = new Error('unknown kid'); e.reason = 'signature'; throw e; }
    }

    // ES256 signature over JWS: 64 raw bytes (r||s), NOT DER.
    let sigBytes;
    try { sigBytes = b64UrlToBytes(s); } catch { const e = new Error('sig b64'); e.reason = 'malformed'; throw e; }
    if (sigBytes.length !== 64) { const e = new Error('sig len'); e.reason = 'signature'; throw e; }

    const signingInput = new TextEncoder().encode(`${h}.${p}`);
    const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        key,
        sigBytes,
        signingInput,
    );
    if (!valid) { const e = new Error('bad sig'); e.reason = 'signature'; throw e; }

    let payload;
    try { payload = JSON.parse(b64UrlToUtf8(p)); } catch { const e = new Error('bad payload'); e.reason = 'malformed'; throw e; }
    return payload;
}

// ─── helpers ────────────────────────────────────────────────────────────────

// Bearer only. The client keeps the session in localStorage and never sets
// a cookie; accepting one here would be an ambient-credential path with no
// CSRF defence (CLAUDE.md: "we're Bearer-only").
function readToken(req) {
    const bearer = req.headers.get('authorization');
    if (bearer && bearer.toLowerCase().startsWith('bearer ')) {
        return bearer.slice(7).trim();
    }
    return null;
}

function b64UrlToBytes(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function b64UrlToUtf8(s) { return new TextDecoder('utf-8', { fatal: true }).decode(b64UrlToBytes(s)); }
function jsonError(status, body) {
    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
