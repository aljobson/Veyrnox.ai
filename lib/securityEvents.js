/**
 * One row per security-relevant refusal at the door (ADR-0104): the category,
 * a short action code, the outcome, the path, the status and our own reason
 * code. Never a token, a header value, a payload, or an address: the source is
 * a keyed hash made here (SECURITY_EVENTS_HASH_KEY), so two refusals from one
 * connection group together and nobody can read the address back. Without the
 * key the source is left out and only the rules that do not group by source
 * run. Read at /app/admin/security.
 *
 * Off unless SECURITY_EVENTS_ENABLED is "true". A write is bounded to a couple
 * of seconds, failures are logged and swallowed, and it never changes the
 * answer the caller gets.
 */

import { fetchWithTimeout } from './fetchWithTimeout.js';

const RECORD_TIMEOUT_MS = 2000;
const REASON_RE = /^[a-z0-9_:. -]{1,80}$/;
const SOURCE_KEY_LENGTH = 24;

export const securityEventsEnabled = (env = process.env) => env.SECURITY_EVENTS_ENABLED === 'true';

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A stable, non-reversible key for the connecting address, or null without a key. */
export async function sourceKey(req, env = process.env) {
    const secret = env.SECURITY_EVENTS_HASH_KEY;
    const ip = req.headers.get('cf-connecting-ip');
    if (!secret || !ip) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
    return toBase64Url(mac).slice(0, SOURCE_KEY_LENGTH);
}

/**
 * Record one event. Resolves whether or not it was written.
 * @param {{category: string, action: string, outcome: 'success'|'failure', req?: Request, status?: number, reason?: string}} event
 */
export async function recordSecurityEvent(event, env = process.env, fetcher = fetchWithTimeout) {
    if (!securityEventsEnabled(env)) return;
    const supabaseUrl = env.SUPABASE_URL;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return;
    try {
        const req = event.req;
        const path = req ? new URL(req.url).pathname : null;
        const res = await fetcher(new URL('/rest/v1/rpc/record_security_event', supabaseUrl), {
            method: 'POST',
            headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                p_category: event.category,
                p_action: event.action,
                p_outcome: event.outcome,
                p_source_key: req ? await sourceKey(req, env) : null,
                p_path: path,
                p_status: event.status ?? null,
                p_reason: event.reason && REASON_RE.test(event.reason) ? event.reason : null,
            }),
        }, RECORD_TIMEOUT_MS);
        if (!res.ok) console.error('[security-events] record failed', event.action, res.status);
    } catch (err) {
        console.error('[security-events] record failed', event.action, err && err.message);
    }
}
