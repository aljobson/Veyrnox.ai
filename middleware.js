/**
 * Root Next.js middleware — gates /api/v1/* on a verified Supabase JWT.
 *
 * Verification lives in `lib/supabaseJwt.js` (ES256 + JWKS via Web Crypto,
 * Bearer-only, no shared secret, no jose) and is unit-tested there. This
 * file only wires it to the request: blank inbound identity headers → read
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

import { editorFeatureEnabled } from './lib/editorRuntimeFlags.mjs';
import { stripContext } from './packages/security/context.js';
import { responseHeaders } from './packages/security/errors.js';
import { recentMfaTimestamp } from './lib/cinema/strongAuth.js';
import { NextResponse } from 'next/server';
import { contentSecurityPolicy } from './lib/contentSecurityPolicy.mjs';
import { LOCAL_SPEECH_WORKER_URL,localSpeechWorkerPolicy } from './app/veyrnox/_lib/localSpeechAssets.mjs';
import {EDITOR_VISION_PATH,editorVisionWorkerPolicy} from './app/veyrnox/_lib/editorVisionRuntime.mjs';
import { readToken, validateClaims, verifyES256 } from './lib/supabaseJwt.js';
import { isPublishApiPath, publishShellAvailable, publishAllowed } from './lib/social/publishFeature.js';
import { isUnknownStaticPage } from './lib/unknownStaticPage.js';
import { LOCALIZED_PATHS, localesEnabled, localizedPathKey, splitLocalePath } from './lib/i18n/locales.mjs';
import { LOCALE_HEADER, PATH_HEADER } from './lib/i18n/headerNames.mjs';
import { recordSecurityEvent } from './lib/securityEvents.js';
const POSTHOG_INGEST_PATH = '/ingest';
const POSTHOG_INGEST_ORIGIN = 'https://eu.i.posthog.com';
const CANONICAL_HOST = 'veyrnox.ai';
const PUBLIC_METADATA_PATHS = new Set(['/robots.txt', '/sitemap.xml']);
const PUBLIC_METADATA_CACHE = 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400';
const NON_HTML_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

export const config = {
    matcher: ['/api/v1/:path*', '/((?!api(?:/|$)|_next(?:/|$)).*)'],
};

// Identity headers set by this middleware and trusted by /api/v1 handlers.
// These are the only x-veyrnox-* request headers a handler may read
// (tests/identityHeaders.test.mjs): every one is given a value here on every
// request, and '' means the verified token had nothing to put in it.
const IDENTITY_HEADERS = [
    'x-veyrnox-auth-id',
    'x-veyrnox-auth-email',
    'x-veyrnox-auth-role',
    // Present only for Supabase OAuth-server access tokens. The middleware
    // uses the signed client_id claim to keep third-party clients inside the
    // deliberately small MCP surface instead of treating them as a browser
    // session with authority over every /api/v1 route.
    'x-veyrnox-auth-client-id',
    // Supabase's authenticator assurance level: 'aal1' password/OAuth only,
    // 'aal2' a second factor was satisfied this session. Forwarded so a
    // handler can demand aal2 without re-parsing the token.
    'x-veyrnox-auth-aal',
    'x-veyrnox-auth-mfa-at',
];

export async function middleware(req, event) {
    const requestUrl = new URL(req.url);
    const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase();
    const host = (forwardedHost || req.headers.get('host')?.toLowerCase() || requestUrl.host.toLowerCase()).replace(/:\d+$/, '');
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    const protocol = forwardedProto || requestUrl.protocol.replace(':', '');

    // Canonicalise the first insecure request as well as the www alias before
    // any application response, rewrite or analytics proxy is produced.
    if ((host === CANONICAL_HOST && protocol === 'http') || host === `www.${CANONICAL_HOST}`) {
        requestUrl.protocol = 'https:';
        requestUrl.host = CANONICAL_HOST;
        requestUrl.port = '';
        return NextResponse.redirect(requestUrl, 308);
    }

    // Same-origin analytics proxy: the browser CSP never needs a PostHog
    // origin. With no configured project key, do not expose a free relay.
    const pathname = req.nextUrl?.pathname ?? requestUrl.pathname;
    if (pathname === POSTHOG_INGEST_PATH || pathname.startsWith(`${POSTHOG_INGEST_PATH}/`)) {
        if (!process.env.NEXT_PUBLIC_POSTHOG_KEY?.startsWith('phc_')) {
            return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });
        }
        return rewritePostHogRequest(req);
    }

    // Identity headers are ours to set. Give every one an explicit value on
    // every branch, so no handler can ever read a client-supplied one.
    // Deleting is not enough: OpenNext forwards the headers set here on top of
    // the client's own and does not apply a deletion (ADR-0078).
    const headers = stripContext(req.headers);
    const requestId = crypto.randomUUID();
    headers.set('x-request-id', requestId);
    for (const h of IDENTITY_HEADERS) headers.set(h, '');

    // These machine-readable documents are public and contain no HTML or
    // executable script, so they do not need a per-request renderer nonce.
    // Cache only the exact routes: every page and authenticated surface keeps
    // the private/no-store policy below. Explicitly blank hostile inbound
    // renderer headers because OpenNext does not reliably apply deletions.
    if (PUBLIC_METADATA_PATHS.has(pathname)) {
        headers.set('x-nonce', '');
        headers.set('content-security-policy', '');
        const response = NextResponse.next({ request: { headers } });
        response.headers.set('Content-Security-Policy', NON_HTML_CSP);
        response.headers.set('Cache-Control', PUBLIC_METADATA_CACHE);
        return response;
    }

    // Page navigation authenticates through the existing client flow. Never
    // demand an API Bearer token for HTML. The renderer consumes this request
    // policy to nonce framework/flight scripts; the response must match it.
    // NextRequest carries nextUrl; a plain Request (tests) only has url.
    // Only this immutable local inference Worker can compile its pinned WASM.
    // HTML and every other script keep the existing nonce policy.
    if(pathname===LOCAL_SPEECH_WORKER_URL||pathname===`${EDITOR_VISION_PATH}/worker.mjs`){
        if(!editorFeatureEnabled('EDITOR_LOCAL_INFERENCE_ENABLED'))return new NextResponse(null,{status:404});
        const response=NextResponse.next({request:{headers}});
        response.headers.set('Content-Security-Policy',(pathname===LOCAL_SPEECH_WORKER_URL?localSpeechWorkerPolicy:editorVisionWorkerPolicy)(new URL(req.url).origin));
        response.headers.set('Cache-Control','no-cache');
        return response;
    }
    if (pathname !== '/api/v1' && !pathname.startsWith('/api/v1/')) {
        const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
        const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
        headers.set('x-nonce', nonce);
        headers.set('Content-Security-Policy', policy);
        // Public-site language (ADR-0106). Both headers get a value on every
        // page request, so a client-supplied copy never reaches a page.
        // /es/... is served by the English-named route with the language in
        // a header; a language prefix on a page with no translation is sent
        // to the English page, never served as a second copy of it.
        let pagePath = pathname;
        let locale = 'en';
        if (localesEnabled()) {
            const split = splitLocalePath(pathname);
            if (split.locale) {
                if (!LOCALIZED_PATHS.has(localizedPathKey(split.rest))) {
                    const target = new URL(split.rest + requestUrl.search, req.url);
                    return NextResponse.redirect(target, { status: 307, headers: { 'cache-control': 'private, no-store, max-age=0' } });
                }
                pagePath = split.rest;
                locale = split.locale;
            }
        }
        headers.set(LOCALE_HEADER, locale);
        headers.set(PATH_HEADER, localizedPathKey(pagePath));
        // An unknown guide or template is sent to a path with no route, so the
        // site's not-found page answers with a real 404 (lib/unknownStaticPage.js).
        const response = isUnknownStaticPage(pagePath)
            ? NextResponse.rewrite(new URL('/_unknown-page', req.url), { request: { headers } })
            : pagePath !== pathname
                ? NextResponse.rewrite(new URL(pagePath + requestUrl.search, req.url), { request: { headers } })
                : NextResponse.next({ request: { headers } });
        response.headers.set('Content-Security-Policy', policy);
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        return response;
    }

    const isMcp = pathname === '/api/v1/mcp';
    const isDeveloperApi = pathname === '/api/v1/developer' || pathname.startsWith('/api/v1/developer/');
    // The developer API is a Bearer-token resource with wildcard CORS. Let a
    // browser discover its allowed headers without presenting credentials;
    // the route answers the preflight and no application handler runs.
    if (isDeveloperApi && req.method === 'OPTIONS') {
        return NextResponse.next({ request: { headers } });
    }

    // No configured rollout: refuse before auth work. A pilot requires JWT verification below.
    if (isPublishApiPath(pathname) && !publishShellAvailable()) {
        return jsonError(503, { error: 'publish_not_open', requestId });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
        return jsonError(503, { error: 'auth not configured', requestId });
    }

    const token = readToken(req);
    if (!token) return reject(req, 'missing', requestId, event);

    let claims;
    try {
        claims = await verifyES256(token, supabaseUrl, { staticJwks: process.env.SUPABASE_JWKS });
    } catch (err) {
        const reason = (err && err.reason) || 'signature';
        // A JWKS outage is our problem, not the caller's credentials:
        // 503 so clients do not bounce users to sign-in during an incident.
        if (reason === 'jwks') {
            console.error('[auth] JWKS unavailable; answering 503');
            return jsonError(503, { error: 'auth_unavailable', requestId });
        }
        return reject(req, reason, requestId, event);
    }

    const claimError = validateClaims(claims, supabaseUrl);
    if (claimError) return reject(req, claimError, requestId, event);

    const oauthClientId = verifiedOAuthClientId(claims);
    if (oauthClientId === false) return reject(req, 'malformed', requestId, event);
    if (oauthClientId && !isMcp && !isDeveloperApi) {
        return jsonError(403, { error: 'oauth_route_forbidden', requestId });
    }
    if (isPublishApiPath(pathname) && !publishAllowed(claims.sub)) {
        return jsonError(503, { error: 'publish_not_open', requestId });
    }

    // Forward verified identity (inbound copies were blanked above).
    headers.set('x-veyrnox-auth-id', claims.sub);
    if (claims.email) headers.set('x-veyrnox-auth-email', String(claims.email));
    if (claims.role) headers.set('x-veyrnox-auth-role', String(claims.role));
    if (oauthClientId) headers.set('x-veyrnox-auth-client-id', oauthClientId);
    headers.set('x-veyrnox-auth-aal', claims.aal === 'aal2' ? 'aal2' : 'aal1');

    const mfaAt = recentMfaTimestamp(claims);
    if (mfaAt !== null) headers.set('x-veyrnox-auth-mfa-at', String(mfaAt));
    const response = NextResponse.next({ request: { headers } });
    for (const [name, value] of Object.entries(responseHeaders(requestId))) response.headers.set(name, value);
    return response;
}

function verifiedOAuthClientId(claims) {
    if (claims.client_id === undefined || claims.client_id === null) return null;
    if (typeof claims.client_id !== 'string') return false;
    const value = claims.client_id.trim();
    // Supabase currently issues UUID client IDs. Keep the accepted alphabet a
    // little broader for registered clients, but never forward control bytes,
    // whitespace or an unbounded signed claim into an HTTP header.
    return /^[A-Za-z0-9._~-]{1,255}$/.test(value) ? value : false;
}

function rewritePostHogRequest(req) {
    const sourceUrl = req.nextUrl ?? new URL(req.url);
    const pathname = sourceUrl.pathname.slice(POSTHOG_INGEST_PATH.length) || '/';
    const target = new URL(pathname, POSTHOG_INGEST_ORIGIN);
    if (target.origin !== POSTHOG_INGEST_ORIGIN) {
        return new NextResponse('Invalid analytics path', { status: 400 });
    }
    target.search = sourceUrl.search;

    // The SDK payload carries its public project token and event data. Site
    // cookies, Supabase bearer tokens and the visitor's forwarding/IP headers
    // are not part of that contract and must not cross the proxy boundary.
    const blockedHeaders = new Set([
        'authorization', 'cookie', 'cf-connecting-ip', 'true-client-ip',
        'x-forwarded-for', 'forwarded', 'x-real-ip', 'x-nonce',
        'content-security-policy',
    ]);
    const headers = new Headers();
    for (const [name, value] of req.headers.entries()) {
        // OpenNext overlays middleware's SET values onto inbound headers, even
        // for external rewrites. Omission/deletion would retain credentials.
        headers.set(name, blockedHeaders.has(name) || name.startsWith('x-veyrnox-') ? '' : value);
    }
    for (const name of blockedHeaders) headers.set(name, '');
    return NextResponse.rewrite(target, { request: { headers } });
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

function jsonError(status, body, extraHeaders = {}) {
    return new NextResponse(JSON.stringify(body), {
        status,
        headers: { ...ERROR_HEADERS, ...extraHeaders, 'x-request-id': body.requestId || crypto.randomUUID() },
    });
}

function oauthChallenge(req, reason) {
    const pathname = new URL(req.url).pathname;
    const resource = pathname === '/api/v1/mcp' ? '/api/v1/mcp'
        : pathname === '/api/v1/developer' || pathname.startsWith('/api/v1/developer/') ? '/api/v1/developer' : null;
    if (!resource) return {};
    const origin = (process.env.PUBLIC_HOST || 'https://veyrnox.ai').replace(/\/$/, '');
    const metadata = `${origin}/.well-known/oauth-protected-resource${resource}`;
    const error = reason === 'missing' ? ''
        : reason === 'insufficient_scope' ? ', error="insufficient_scope"'
            : ', error="invalid_token"';
    return {
        'www-authenticate': `Bearer resource_metadata="${metadata}"${error}`,
        ...(resource === '/api/v1/developer' ? {
            'access-control-allow-origin': '*',
            'access-control-expose-headers': 'Retry-After, WWW-Authenticate, X-Request-Id',
        } : {}),
    };
}

/**
 * Refuse a request, and say so in the log.
 *
 * Every rejection was silent, so a forged-token or credential-stuffing burst
 * against /api/v1/* left no trace anywhere — the one thing CLAUDE.md's OWASP
 * #9 line says this file does (audit 2026-09-23). The reason is one of our
 * own short codes; no token, header or claim value is ever logged.
 */
function reject(req, reason, requestId, event) {
    console.error('[auth] rejected', new URL(req.url).pathname, 'reason:', reason);
    // ADR-0104: the same refusal as a security event, off the response path.
    const recorded = recordSecurityEvent({ category: 'auth', action: 'request.reject', outcome: 'failure', req, status: 401, reason });
    if (event && typeof event.waitUntil === 'function') event.waitUntil(recorded);
    return jsonError(401, { error: 'unauthorized', reason, requestId }, oauthChallenge(req, reason));
}
