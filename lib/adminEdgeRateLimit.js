// Traffic screening before Access/JWT verification and admin route work.
// Cloudflare counters are per-location and approximate, never money accounting.
const ADMIN_PATH = /^\/api\/(?:v1\/)?admin(?:\/|$)/i;
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

function adminPath(url) {
    let path = new URL(url).pathname;
    // Cover encoded path segments and slash normalization without changing the
    // request forwarded to Next. Invalid encodings remain for the app to reject.
    try { path = decodeURIComponent(path); } catch { /* malformed URL */ }
    path = path.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
    path = new URL(path, 'https://path.invalid').pathname;
    return ADMIN_PATH.test(path);
}

function connectingIp(raw) {
    if (!raw || raw.length > 45) return 'unknown';
    if (/^[0-9a-f:.]+$/i.test(raw) && raw.includes(':')) {
        try { return new URL(`https://[${raw}]/`).hostname.slice(1, -1); } catch { return 'unknown'; }
    }
    const parts = raw.split('.');
    return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
        ? parts.map(Number).join('.') : 'unknown';
}

function response(status, error, retry) {
    return new Response(JSON.stringify({ error, retry_after_seconds: retry }), {
        status, headers: { ...HEADERS, 'Retry-After': String(retry) },
    });
}

export async function adminEdgeRateLimit(request, env) {
    if (!adminPath(request.url)) return null;
    // Only Cloudflare's connecting-IP header selects the bucket. Never key on
    // caller-supplied identity, Authorization, X-Forwarded-For, path or query.
    // Missing/malformed IPs share one bounded fallback; they are not exempt.
    const ip = connectingIp(request.headers.get('cf-connecting-ip'));
    let result;
    try {
        result = await env.ADMIN_EDGE_RATE_LIMITER.limit({ key: `veyrnox-ai:admin:v1:${ip}` });
    } catch {
        console.error('[admin-edge] rate limiter unavailable');
    }
    if (result?.success === false) return response(429, 'rate_limited', 60);
    if (result?.success !== true) return response(503, 'rate_limit_unavailable', 30);
    return null;
}
