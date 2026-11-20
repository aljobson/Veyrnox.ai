/**
 * Signed-in devices (ADR-0363). Bearer-only like the rest of /api/v1: identity is
 * the x-veyrnox-auth-id the middleware set. A caller sees and ends only their own
 * sessions; the account id never comes from the client.
 *
 * GET /api/v1/account/sessions
 *   200: { sessions: [{ id, last_used, created_at, device: { kind, browser, system } }] }
 *   Newest first, at most 50, expired sessions left out. No IP address, no raw user agent.
 *   The client marks "This device" by comparing `id` with the session_id claim of
 *   its own access token; the server does not need to know which one is current.
 *
 * DELETE /api/v1/account/sessions   Body: { id }
 *   200: { ended: boolean } — false when it was already gone or is not this account's,
 *   so a replay is a no-op and a guessed id reveals nothing.
 *   An already issued access token keeps working until it expires (as with the
 *   Supabase "sign out others" button); the session can no longer be refreshed.
 *
 * Errors: 400 body_invalid | id_invalid, 401 not_authenticated, 403 origin_forbidden,
 *   503 sessions_unavailable (also before migration 0565 is applied).
 */
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { describeSessionDevice } from '../../../../../lib/sessionDeviceLabel.js';
import { isUuidLoose } from '../../../../../lib/validate.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const unavailable = () => reply({ error: 'sessions_unavailable' }, 503);

function gate(req, write) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!isUuidLoose(authId || '')) return { response: reply({ error: 'not_authenticated' }, 401) };
    if (write) {
        const origin = req.headers.get('origin');
        if ((origin && origin !== new URL(req.url).origin)
            || ['cross-site', 'same-site'].includes(req.headers.get('sec-fetch-site'))) {
            return { response: reply({ error: 'origin_forbidden' }, 403) };
        }
    }
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: unavailable() };
    return { authId, cfg };
}

const iso = value => {
    const ms = Date.parse(typeof value === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? `${value}Z` : value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

export async function GET(req) {
    const g = gate(req, false);
    if (g.response) return g.response;
    let rows;
    try {
        rows = await rpc('list_account_sessions', { p_auth_id: g.authId }, g.cfg);
    } catch (err) {
        console.error('[api/v1/account/sessions] list failed:', err?.status ?? 0);
        return unavailable();
    }
    if (!Array.isArray(rows)) return unavailable();
    const sessions = rows
        .filter(row => row && typeof row.id === 'string' && isUuidLoose(row.id))
        .map(row => ({
            id: row.id,
            last_used: iso(row.last_used),
            created_at: iso(row.created_at),
            device: describeSessionDevice(row.user_agent),
        }));
    return reply({ sessions });
}

export async function DELETE(req) {
    const g = gate(req, true);
    if (g.response) return g.response;
    let body;
    try { body = await req.json(); } catch { return reply({ error: 'body_invalid' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'body_invalid' }, 400);
    if (typeof body.id !== 'string' || !isUuidLoose(body.id)) return reply({ error: 'id_invalid' }, 400);
    try {
        const ended = await rpc('revoke_account_session', { p_auth_id: g.authId, p_session_id: body.id }, g.cfg);
        return reply({ ended: ended === true });
    } catch (err) {
        console.error('[api/v1/account/sessions] revoke failed:', err?.status ?? 0);
        return unavailable();
    }
}
