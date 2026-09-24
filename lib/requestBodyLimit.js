import { readBoundedBody } from './boundedBody.js';

export const JSON_BODY_LIMIT = 64 * 1024;
export const WEBHOOK_BODY_LIMIT = 1024 * 1024;
const HEADERS = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const refusal = (status, error) => new Response(JSON.stringify({ error }), { status, headers: HEADERS });

/** Bound incoming writes before framework parsing. Preserve webhook bytes exactly. */
export async function limitRequestBody(request, timeoutMs = 10000) {
    if (!request.body) return { request };
    const path = new URL(request.url).pathname;
    const maxBytes = path.startsWith('/api/webhook/') ? WEBHOOK_BODY_LIMIT : JSON_BODY_LIMIT;
    if (Number(request.headers.get('content-length')) > maxBytes) {
        void request.body.cancel().catch(() => {});
        return { response: refusal(413, 'body_too_large') };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'AbortError')), timeoutMs);
    try {
        const bytes = await readBoundedBody(request.body, maxBytes, controller.signal);
        return { request: new Request(request, { body: bytes }) };
    } catch (err) {
        if (err?.status === 413) return { response: refusal(413, 'body_too_large') };
        if (err?.name === 'AbortError') return { response: refusal(408, 'body_timeout') };
        return { response: refusal(400, 'invalid_body') };
    } finally { clearTimeout(timer); }
}
