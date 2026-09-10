/**
 * Root Next.js middleware — gates the Veyrnox gateway `/api/v1/*` on a
 * verified Supabase JWT. Downstream route handlers read `x-veyrnox-auth-id`
 * from the request headers (set here) to identify the caller.
 *
 * NOT wired at the studio proxy paths (`/api/agents/*`, `/api/workflow/*`,
 * `/api/app/*`, `/api/upload-binary`, `/api/session/*`) which still use the
 * legacy `__Host-muapi_key` cookie — those sunset in Slice 9 when the
 * studio rewires to `/api/v1/*`. The `matcher` below is deliberately
 * narrow to keep this middleware off the legacy hot path.
 *
 * Requires two env vars at request time:
 *   SUPABASE_URL          e.g. https://<ref>.supabase.co
 *   SUPABASE_JWT_SECRET   set via `wrangler secret put SUPABASE_JWT_SECRET`
 * Without them the middleware fail-closes with 503 — a misconfigured
 * deployment must not accept traffic.
 */

import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

export const config = {
    matcher: ['/api/v1/:path*'],
};

const encoder = new TextEncoder();

export async function middleware(req) {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!jwtSecret || !supabaseUrl) {
        return jsonError(503, { error: 'auth not configured' });
    }

    const token = readToken(req, supabaseUrl);
    if (!token) return jsonError(401, { error: 'unauthorized', reason: 'missing' });

    let claims;
    try {
        const issuer = new URL('/auth/v1', supabaseUrl).toString();
        const result = await jwtVerify(token, encoder.encode(jwtSecret), {
            issuer,
            audience: 'authenticated',
            algorithms: ['HS256'],
            clockTolerance: 5,
        });
        claims = result.payload;
    } catch (err) {
        const code = err && err.code;
        let reason = 'signature';
        if (code === 'ERR_JWT_EXPIRED') reason = 'expired';
        else if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
            reason = err.claim === 'iss' ? 'issuer' : err.claim === 'aud' ? 'audience' : 'claim';
        }
        return jsonError(401, { error: 'unauthorized', reason });
    }

    if (!claims || !claims.sub) {
        return jsonError(401, { error: 'unauthorized', reason: 'malformed' });
    }

    // Forward verified auth to the downstream route via hop-by-hop
    // headers. Overwrite any incoming header of the same name so a
    // client can never spoof it.
    const headers = new Headers(req.headers);
    headers.set('x-veyrnox-auth-id', String(claims.sub));
    if (claims.email) headers.set('x-veyrnox-auth-email', String(claims.email));
    if (claims.role) headers.set('x-veyrnox-auth-role', String(claims.role));

    return NextResponse.next({ request: { headers } });
}

/**
 * Read the token from either the Authorization: Bearer header or the
 * Supabase SSR cookie (sb-<project-ref>-auth-token). The SSR cookie
 * stores the token as either a raw string or a JSON array of the
 * shape [accessToken, refreshToken, ...]. Accept both.
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
        if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
            return parsed[0];
        }
    } catch {
        // Not JSON — treat raw as the token.
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
