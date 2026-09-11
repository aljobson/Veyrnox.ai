/**
 * Root Next.js middleware — gates /api/v1/* on a verified Supabase JWT.
 *
 * Verification lives in `lib/supabaseJwt.js` (ES256 + JWKS via Web Crypto,
 * Bearer-only, no shared secret, no jose) and is unit-tested there. This
 * file only wires it to the request: strip inbound identity headers → read
 * token → verify signature → check claims → forward verified identity.
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
import { readToken, validateClaims, verifyES256 } from './lib/supabaseJwt.js';

export const config = {
    matcher: ['/api/v1/:path*'],
};

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

    const claimError = validateClaims(claims, supabaseUrl);
    if (claimError) return jsonError(401, { error: 'unauthorized', reason: claimError });

    // Forward verified identity (inbound copies were deleted above).
    headers.set('x-veyrnox-auth-id', claims.sub);
    if (claims.email) headers.set('x-veyrnox-auth-email', String(claims.email));
    if (claims.role) headers.set('x-veyrnox-auth-role', String(claims.role));

    return NextResponse.next({ request: { headers } });
}

function jsonError(status, body) {
    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
