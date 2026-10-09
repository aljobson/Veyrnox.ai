// POST /api/turnstile-failure (ADR-0026 amendment 2): the browser says that
// Turnstile's check failed, and with which error code. Whoever is stopped at
// the check is not signed in, so the route sits outside /api/v1 and has two
// protections of its own: a rate limit in worker.js, and a handler that takes
// one code from a page of ours and writes that code and nothing else.
import { turnstileErrorCode } from '../app/lib/turnstileFailure.js';
import { REFUSAL_HEADERS, connectingIp, normalizedPath } from './adminEdgeRateLimit.js';
import { readBoundedBody } from './boundedBody.js';

// The longest body is nine digits.
export const REPORT_BODY_LIMIT = 16;
const REPORT_PATH = /^\/api\/turnstile-failure\/?$/i;

const refusal = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...REFUSAL_HEADERS, ...headers } });

// As sent and as normalised, like the admin screen: no spelling of the path
// that the app would still route reaches it unlimited.
function reportPath(url) {
    const path = normalizedPath(url);
    return path === null || REPORT_PATH.test(path) || REPORT_PATH.test(new URL(url).pathname);
}

// One home or mobile connection holds a whole IPv6 /64, so the /64 is the
// bucket: otherwise every address in it would have a quota of its own.
function bucket(ip) {
    if (!ip.includes(':')) return ip;
    const [left, right = []] = ip.split('::').map((part) => (part ? part.split(':') : []));
    const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    return `${groups.slice(0, 4).join(':')}::/64`;
}

/**
 * Screen a report in the Worker, before the app and before the body is read.
 * The same per-location, approximate counter as the admin screen (ADR-0039),
 * with a binding and a key of its own.
 * @param {Request} request
 * @param {{ TURNSTILE_REPORT_RATE_LIMITER?: { limit: (o: { key: string }) => Promise<{ success: boolean }> } }} env
 * @returns {Promise<Response | null>} a refusal, or null to let the request through
 */
export async function turnstileReportRateLimit(request, env) {
    if (!reportPath(request.url)) return null;
    if (request.method !== 'POST') return refusal(405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    // Cloudflare's connecting address selects the bucket and nothing a caller
    // can choose does. It is the counter's key only: never logged or stored.
    const ip = connectingIp(request.headers.get('cf-connecting-ip'));
    let result;
    try {
        result = await env.TURNSTILE_REPORT_RATE_LIMITER.limit({ key: `veyrnox-ai:turnstile-failure:v1:${bucket(ip)}` });
    } catch {
        console.error('[turnstile-report] rate limiter unavailable');
    }
    if (result?.success === false) return refusal(429, { error: 'rate_limited', retry_after_seconds: 60 }, { 'Retry-After': '60' });
    // Without a working limiter nothing is counted: an unlimited writer to the log is worse than a gap in the count.
    if (result?.success !== true) return refusal(503, { error: 'rate_limit_unavailable', retry_after_seconds: 30 }, { 'Retry-After': '30' });
    return null;
}

// A browser states where a request came from in headers that page script
// cannot set. Sec-Fetch-Site is the direct answer. One too old to send it
// still sends Origin on a POST. A caller that sends neither is no page of ours.
function fromOurOwnPage(request) {
    const site = request.headers.get('sec-fetch-site');
    if (site !== null) return site === 'same-origin';
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    if (!origin || !host) return false;
    try { return new URL(origin).host === host; } catch { return false; }
}

/**
 * Count one failed check. The body must be exactly what turnstileErrorCode
 * returns: 3 to 9 digits, or "unknown".
 * @param {Request} request
 * @param {(line: { event: string, code: string }) => void} [log]
 * @returns {Promise<Response>} 204 with no body, or a typed refusal
 */
export async function acceptTurnstileFailure(request, log = console.error) {
    if (!fromOurOwnPage(request)) return refusal(403, { error: 'cross_site_request' });
    let bytes;
    try {
        bytes = await readBoundedBody(request.body, REPORT_BODY_LIMIT);
    } catch (err) {
        return err?.status === 413 ? refusal(413, { error: 'body_too_large' }) : refusal(400, { error: 'invalid_body' });
    }
    // Decoded as sent: a byte-order mark stays in the text, and so fails the comparison.
    const code = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    if (turnstileErrorCode(code) !== code) return refusal(400, { error: 'invalid_code' });
    // An object, not text: Workers Logs indexes its keys, so the count can be grouped by code.
    log({ event: 'auth.turnstile_check_failed', code });
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
