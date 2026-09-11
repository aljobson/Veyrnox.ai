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
let jwksCache = null; // { fetchedAt, byKid: Map<string, CryptoKey> }

export async function middleware(req) {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
        return jsonError(503, { error: 'auth not configured' });
    }

    const token = readToken(req, supabaseUrl);
    if (!token) return jsonError(401, { error: 'unauthorized', reason: 'missing' });

    let claims;
    try {
        claims = await verifyES256(token, supabaseUrl);
    } catch (err) {
        return jsonError(401, { error: 'unauthorized', reason: (err && err.reason) || 'signature' });
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

    // Forward verified identity. Overwrite inbound headers of the same
    // name so a client can never spoof them.
    const headers = new Headers(req.headers);
    headers.set('x-veyrnox-auth-id', claims.sub);
    if (claims.email) headers.set('x-veyrnox-auth-email', String(claims.email));
    if (claims.role) headers.set('x-veyrnox-auth-role', String(claims.role));

    return NextResponse.next({ request: { headers } });
}

// ─── ES256 verification via Web Crypto ─────────────────────────────────────

async function loadJwks(supabaseUrl) {
    const now = Date.now();
    if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.byKid;
    const res = await fetch(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
    if (!res.ok) {
        const e = new Error(`jwks ${res.status}`); e.reason = 'signature'; throw e;
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
        const e = new Error('no usable jwks keys'); e.reason = 'signature'; throw e;
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
        // Cache miss — refresh once. Handles rotation without waiting for TTL.
        jwksCache = null;
        const refreshed = await loadJwks(supabaseUrl);
        key = refreshed.get(header.kid);
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

function readToken(req, supabaseUrl) {
    const bearer = req.headers.get('authorization');
    if (bearer && bearer.toLowerCase().startsWith('bearer ')) {
        return bearer.slice(7).trim();
    }
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    const cookieName = `sb-${projectRef}-auth-token`;
    const cookieHeader = req.headers.get('cookie') || '';
    const match = new RegExp(`(?:^|;\\s*)${escapeRegex(cookieName)}=([^;]+)`).exec(cookieHeader);
    if (!match) return null;
    let raw;
    try { raw = decodeURIComponent(match[1]); } catch { return null; }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
    } catch { /* raw */ }
    return raw;
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
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function jsonError(status, body) {
    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
