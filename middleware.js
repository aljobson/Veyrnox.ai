/**
 * Root Next.js middleware — gates the Veyrnox gateway `/api/v1/*` on a
 * verified Supabase JWT. Downstream route handlers read `x-veyrnox-auth-id`
 * from the request headers (set here) to identify the caller.
 *
 * NOT wired at the studio proxy paths (`/api/agents/*`, `/api/workflow/*`,
 * `/api/app/*`, `/api/upload-binary`, `/api/session/*`) which still use the
 * legacy `__Host-muapi_key` cookie until the 2026-10-10 sunset.
 *
 * Uses Web Crypto for HS256 verification instead of `jose` — jose is
 * pure JS but bundles in a shape that trips the OpenNext / Cloudflare
 * Workers Builds pipeline (bisected on this PR). Web Crypto is native
 * in the Worker runtime and matches Supabase's HS256 exactly. The
 * standalone `packages/auth/verify.ts` still uses jose for Node-side
 * unit tests where fetch performance and shape don't matter.
 *
 * Requires two env vars at request time:
 *   SUPABASE_URL          e.g. https://<ref>.supabase.co
 *   SUPABASE_JWT_SECRET   set via `wrangler secret put SUPABASE_JWT_SECRET`
 * Without them the middleware fail-closes with 503.
 */

import { NextResponse } from 'next/server';

export const config = {
    matcher: ['/api/v1/:path*'],
};

export async function middleware(req) {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!jwtSecret || !supabaseUrl) {
        return jsonError(503, { error: 'auth not configured' });
    }

    const token = readToken(req, supabaseUrl);
    if (!token) return jsonError(401, { error: 'unauthorized', reason: 'missing' });

    const claims = await verifyHS256(token, jwtSecret);
    if (!claims.ok) {
        return jsonError(401, { error: 'unauthorized', reason: claims.reason });
    }

    // Check iss + aud + exp locally (verifyHS256 already checked the signature).
    const expectedIssuer = new URL('/auth/v1', supabaseUrl).toString();
    if (claims.payload.iss !== expectedIssuer) {
        return jsonError(401, { error: 'unauthorized', reason: 'issuer' });
    }
    const aud = claims.payload.aud;
    const audMatch = aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated'));
    if (!audMatch) {
        return jsonError(401, { error: 'unauthorized', reason: 'audience' });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof claims.payload.exp !== 'number' || claims.payload.exp + 5 < nowSec) {
        return jsonError(401, { error: 'unauthorized', reason: 'expired' });
    }
    if (typeof claims.payload.sub !== 'string' || !claims.payload.sub) {
        return jsonError(401, { error: 'unauthorized', reason: 'malformed' });
    }

    const headers = new Headers(req.headers);
    headers.set('x-veyrnox-auth-id', claims.payload.sub);
    if (claims.payload.email) headers.set('x-veyrnox-auth-email', String(claims.payload.email));
    if (claims.payload.role) headers.set('x-veyrnox-auth-role', String(claims.payload.role));

    return NextResponse.next({ request: { headers } });
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Minimal HS256 JWT verifier over Web Crypto. Returns
 * { ok: true, payload } on valid signature (does NOT check claims — caller
 * checks iss/aud/exp separately). Returns { ok: false, reason } otherwise.
 */
async function verifyHS256(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'malformed' };
    const [h, p, s] = parts;

    let header;
    try {
        header = JSON.parse(b64UrlToUtf8(h));
    } catch {
        return { ok: false, reason: 'malformed' };
    }
    if (header.alg !== 'HS256') return { ok: false, reason: 'signature' };

    let signatureBytes;
    try {
        signatureBytes = b64UrlToBytes(s);
    } catch {
        return { ok: false, reason: 'malformed' };
    }

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify'],
    );
    const signingInput = new TextEncoder().encode(`${h}.${p}`);
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, signingInput);
    if (!valid) return { ok: false, reason: 'signature' };

    let payload;
    try {
        payload = JSON.parse(b64UrlToUtf8(p));
    } catch {
        return { ok: false, reason: 'malformed' };
    }
    return { ok: true, payload };
}

function b64UrlToBytes(s) {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function b64UrlToUtf8(s) {
    return new TextDecoder('utf-8', { fatal: true }).decode(b64UrlToBytes(s));
}

/**
 * Read the token from Authorization: Bearer or the Supabase SSR cookie
 * (sb-<project-ref>-auth-token). SSR cookie stores raw string or a
 * JSON array [accessToken, refreshToken, ...] — accept either.
 */
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
    try {
        raw = decodeURIComponent(match[1]);
    } catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
    } catch {
        // Not JSON; use raw.
    }
    return raw;
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonError(status, body) {
    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
