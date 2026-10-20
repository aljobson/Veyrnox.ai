/**
 * One clean answer for "Supabase is not answering" (ADR-0160 follow-up).
 *
 * Routes catch a failed database call and answer in their own words (500
 * `internal`, 502 `top_up_create_failed`, ...). A client cannot tell those from
 * a bug. So the Worker runs each /api/v1 request inside a scope; the Supabase
 * client notes into it when a call fails with no response, a timeout or a 5xx;
 * and when the route then answers a server error, the Worker replaces that
 * answer with 503 `service_unavailable` and a Retry-After. Routes can also call
 * `serviceUnavailable()` directly.
 *
 * Only the response changes. Nothing here writes, retries or skips a ledger
 * call, so a debit still has its refund path and a replay with the same
 * idempotency key is still a no-op: the client retries the same request.
 *
 * The scope lives on globalThis because the Worker entry and the OpenNext
 * bundle each carry their own copy of this module.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const OUTAGE_RETRY_AFTER_SECONDS = 10;
const SCOPE_KEY = Symbol.for('veyrnox.outageScope');
// Statuses a route uses for "something upstream failed"; a 4xx is never rewritten.
const REWRITABLE = new Set([500, 502, 503, 504]);

function storage() {
    return (globalThis[SCOPE_KEY] ??= new AsyncLocalStorage());
}

/** True for a Supabase failure that means "not answering": no response, a timeout, or a 5xx. */
export function isOutageStatus(status) {
    return status === 0 || (Number.isInteger(status) && status >= 500);
}

/** Called by SupabaseError; a no-op outside a request scope (cron, tests). */
export function noteOutage() {
    const scope = storage().getStore();
    if (scope) scope.outage = true;
}

export function runInOutageScope(fn) {
    return storage().run({ outage: false }, fn);
}

export function outageNoted() {
    return storage().getStore()?.outage === true;
}

export function requestIdFor(request) {
    return request?.headers?.get?.('cf-ray') || globalThis.crypto.randomUUID();
}

/** The one outage shape: 503 {error:'service_unavailable', requestId} with Retry-After. */
export function serviceUnavailable(request) {
    return new Response(JSON.stringify({ error: 'service_unavailable', requestId: requestIdFor(request) }), {
        status: 503,
        headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'retry-after': String(OUTAGE_RETRY_AFTER_SECONDS),
        },
    });
}

// The gateway, plus the anonymous read-only routes outside it that read Supabase (CLAUDE.md "Routes outside the gate").
const SHAPED_PREFIXES = ['/api/v1/', '/api/cinema/'];
const SHAPED_EXACT = new Set([
    '/api/catalog', '/api/credit-packs', '/api/presets', '/api/popular-templates',
    '/api/credit-subscription-plans', '/api/cinema-pass-plans',
]);

export function isShapedPath(pathname) {
    return SHAPED_EXACT.has(pathname) || SHAPED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isGatewayPath(request) {
    return isShapedPath(new URL(request.url).pathname);
}

/**
 * Runs `send(request)` in an outage scope and swaps a server-error answer for the
 * clean 503 when a Supabase call failed during the request.
 */
export async function withOutageShape(request, send) {
    if (!isGatewayPath(request)) return send(request);
    return runInOutageScope(async () => {
        const response = await send(request);
        if (!REWRITABLE.has(response.status) || !outageNoted()) return response;
        const type = response.headers.get('content-type') || '';
        if (type.includes('text/event-stream')) return response;
        console.error('[outage] supabase failure behind', response.status, new URL(request.url).pathname);
        return serviceUnavailable(request);
    });
}
