import { connectingIp, normalizedPath, REFUSAL_HEADERS } from './adminEdgeRateLimit.js';

const API = /^\/api(?:\/|$)/i;
const SPECIALIZED = /^\/api\/(?:(?:v1\/)?admin(?:\/|$)|turnstile-failure\/?$)/i;
const WEBHOOK = /^\/api\/webhook(?:\/|$)/i;
const AUTH = /^\/api\/auth(?:\/|$)/i;

// The /64 prevents a caller rotating addresses on one IPv6 connection from
// receiving a separate quota for every address. Addresses never reach logs.
function bucket(ip) {
    if (!ip.includes(':')) return ip;
    const [left, right = []] = ip.split('::').map(part => part ? part.split(':') : []);
    const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    return `${groups.slice(0, 4).join(':')}::/64`;
}

function refusal(status, error, retry) {
    return Response.json({ error, retry_after_seconds: retry }, {
        status, headers: { ...REFUSAL_HEADERS, 'Retry-After': String(retry) },
    });
}

/** Approximate screening before authentication/body work, never a billing quota. */
export async function apiEdgeRateLimit(request, env) {
    const raw = new URL(request.url).pathname;
    const path = normalizedPath(request.url);
    if (path !== null && !API.test(path) && !API.test(raw)) return null;
    // These routes already fail closed behind their own tighter bindings.
    if (SPECIALIZED.test(path || '') || SPECIALIZED.test(raw)) return null;
    // Callbacks have their own bucket: polling and generation requests from
    // a customer sharing an egress address cannot starve provider completion.
    const family = WEBHOOK.test(path || '') || WEBHOOK.test(raw) ? 'provider-webhook' : 'api';
    const auth = AUTH.test(path || '') || AUTH.test(raw);
    const ip = bucket(connectingIp(request.headers.get('cf-connecting-ip')));
    let result;
    try {
        const limiter = auth ? env.AUTH_EDGE_RATE_LIMITER : env.API_EDGE_RATE_LIMITER;
        result = await limiter.limit({ key: `veyrnox-ai:${auth ? 'auth' : family}:v1:${ip}` });
    } catch {
        console.error('[api-edge] rate limiter unavailable');
    }
    if (result?.success === false) return refusal(429, 'rate_limited', 60);
    if (result?.success !== true) return refusal(503, 'rate_limit_unavailable', 30);
    return null;
}
