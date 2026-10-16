import { fetchWithTimeout } from './fetchWithTimeout.js';
import { readBoundedBody } from './boundedBody.js';

export const REFRESH_COOKIE = '__Host-veyrnox_refresh';
const cookie = (value, maxAge = 60 * 60 * 24 * 30) =>
    `${REFRESH_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9._~-]{1,2048}$/.test(value);
function refreshCookie(req) {
    const values = (req.headers.get('cookie') || '').split(';').map(part => part.trim())
        .filter(part => part.startsWith(`${REFRESH_COOKIE}=`));
    if (values.length !== 1) return null;
    try { const token = decodeURIComponent(values[0].slice(REFRESH_COOKIE.length + 1)); return validToken(token) ? token : null; }
    catch { return null; }
}
function json(data, status = 200, setCookie) {
    return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store',
        'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } });
}

/** The sole ambient-cookie endpoint. Ordinary product APIs remain Bearer-only. */
export function createBrowserSessionHandler(cfg, transport = fetchWithTimeout) {
    return async function handle(req) {
        // JSON plus a custom header forces cross-origin scripts through preflight;
        // no CORS headers are emitted. Exact Origin also rejects sibling domains.
        if (req.headers.get('origin') !== new URL(req.url).origin
            || !/^application\/json(?:;|$)/i.test(req.headers.get('content-type') || '')
            || req.headers.get('x-session-request') !== '1'
            || ['cross-site', 'same-site'].includes(req.headers.get('sec-fetch-site'))) {
            return json({ error: 'session_origin_rejected' }, 403);
        }
        let body;
        try { body = JSON.parse(new TextDecoder().decode(await readBoundedBody(req.body, 4096, AbortSignal.timeout(5000)))); }
        catch { return json({ error: 'invalid_request' }, 400); }
        if (body?.action === 'clear') return json({ ok: true }, 200, cookie('', 0));
        if (!['establish', 'refresh'].includes(body?.action)) return json({ error: 'invalid_request' }, 400);
        const token = body.action === 'establish' ? body.refresh_token : refreshCookie(req);
        if (!validToken(token)) return json({ error: 'no_session' }, 401);
        if (!cfg.supabaseUrl || !cfg.anonKey) return json({ error: 'auth_unavailable' }, 503);
        let upstream;
        try {
            upstream = await transport(new URL('/auth/v1/token?grant_type=refresh_token', cfg.supabaseUrl), {
                method: 'POST', headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: token }), cache: 'no-store',
            }, 10000, 128 * 1024);
        } catch { return json({ error: 'auth_unavailable' }, 502); }
        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
            const invalid = [400, 401].includes(upstream.status)
                && ['invalid_grant', 'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found']
                    .includes(data.error_code || data.code || data.error);
            return json({ error: invalid ? 'invalid_grant' : 'auth_unavailable' },
                upstream.status === 429 ? 429 : invalid ? upstream.status : 502, invalid ? cookie('', 0) : undefined);
        }
        if (typeof data.access_token !== 'string' || !validToken(data.refresh_token)) {
            return json({ error: 'auth_unavailable' }, 502);
        }
        return json({ access_token: data.access_token, expires_at: data.expires_at,
            expires_in: data.expires_in, user: data.user || null }, 200, cookie(data.refresh_token));
    };
}
