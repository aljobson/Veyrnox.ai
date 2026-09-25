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
 * Runtime env:
 *   SUPABASE_URL   e.g. https://<ref>.supabase.co  (required)
 * Without it the middleware fail-closes with 503 — a misconfigured
 * deployment must not accept traffic.
 */

import { stripContext } from './packages/security/context.js';
import { responseHeaders } from './packages/security/errors.js';
import { recentMfaTimestamp } from './lib/cinema/strongAuth.js';
import { NextResponse } from 'next/server';
import { readToken, validateClaims, verifyES256 } from './lib/supabaseJwt.js';

export const config = {
    matcher: ['/api/v1/:path*'],
};

// Identity headers set by this middleware and trusted by /api/v1 handlers.
const IDENTITY_HEADERS = [
    'x-veyrnox-auth-id',
    'x-veyrnox-auth-email',
    'x-veyrnox-auth-role',
    // Supabase's authenticator assurance level: 'aal1' password/OAuth only,
    // 'aal2' a second factor was satisfied this session. Forwarded so a
    // handler can demand aal2 without re-parsing the token.
    'x-veyrnox-auth-aal',
    'x-veyrnox-auth-mfa-at',
];

export async function middleware(req) {
    // Identity headers are ours to set. Strip any inbound copy on every
    // branch, so no handler can ever read a client-supplied value.
    const headers = stripContext(req.headers);
    const requestId = crypto.randomUUID();
    headers.set('x-request-id', requestId);
    for (const h of IDENTITY_HEADERS) headers.delete(h);

    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
        return jsonError(503, { error: 'auth not configured', requestId });
    }

    const token = readToken(req);
    if (!token) return reject(req, 'missing', requestId);

    let claims;
    try {
        claims = await verifyES256(token, supabaseUrl);
    } catch (err) {
        const reason = (err && err.reason) || 'signature';
        // A JWKS outage is our problem, not the caller's credentials:
        // 503 so clients do not bounce users to sign-in during an incident.
        if (reason === 'jwks') {
            console.error('[auth] JWKS unavailable; answering 503');
            return jsonError(503, { error: 'auth_unavailable', requestId });
        }
        return reject(req, reason, requestId);
    }

    const claimError = validateClaims(claims, supabaseUrl);
    if (claimError) return reject(req, claimError, requestId);

    // Forward verified identity (inbound copies were deleted above).
    headers.set('x-veyrnox-auth-id', claims.sub);
    if (claims.email) headers.set('x-veyrnox-auth-email', String(claims.email));
    if (claims.role) headers.set('x-veyrnox-auth-role', String(claims.role));
    if (claims.aal) headers.set('x-veyrnox-auth-aal', String(claims.aal));

    const mfaAt = recentMfaTimestamp(claims);
    if (mfaAt !== null) headers.set('x-veyrnox-auth-mfa-at', String(mfaAt));
    const response = NextResponse.next({ request: { headers } });
    for (const [name, value] of Object.entries(responseHeaders(requestId))) response.headers.set(name, value);
    return response;
}

// Responses the middleware returns itself never pass through next.config.mjs
// `headers()`, so they would ship without CSP or HSTS. These are tiny JSON
// bodies with no scripts, styles or frames, so the strictest policy applies.
const ERROR_HEADERS = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
};

function jsonError(status, body) {
    return new NextResponse(JSON.stringify(body), { status, headers: { ...ERROR_HEADERS, 'x-request-id': body.requestId || crypto.randomUUID() } });
}

/**
 * Refuse a request, and say so in the log.
 *
 * Every rejection was silent, so a forged-token or credential-stuffing burst
 * against /api/v1/* left no trace anywhere — the one thing CLAUDE.md's OWASP
 * #9 line says this file does (audit 2026-09-23). The reason is one of our
 * own short codes; no token, header or claim value is ever logged.
 */
function reject(req, reason, requestId) {
    console.error('[auth] rejected', new URL(req.url).pathname, 'reason:', reason);
    return jsonError(401, { error: 'unauthorized', reason, requestId });
}
