/**
 * One row per inbound webhook delivery (ADR-0083): the source, the outcome
 * class, the HTTP status we answered and the typed error code, nothing from
 * the payload. Read at /app/admin/webhooks.
 *
 * `withDeliveryLog(source, handler)` wraps a route's POST. The handler runs
 * unchanged and its response is returned as is; the row is written after it,
 * through record_webhook_delivery, bounded to a couple of seconds and never
 * able to change the answer the provider sees. Logging is on only when
 * WEBHOOK_DELIVERY_LOG_ENABLED is "true", so a unit test of a route sees the
 * fetches it always saw.
 */

import { envConfig } from '../packages/db/supabase-client.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const RECORD_TIMEOUT_MS = 2000;
const ERROR_RE = /^[a-z0-9_:. -]{1,80}$/;

/** The outcome class for a status and the JSON body we answered with. */
export function classify(status, body) {
    if (status === 503 || status === 502) return 'unavailable';
    if (status >= 500) return 'failed';
    if (status === 401) return 'rejected_signature';
    if (status >= 400) return 'rejected';
    if (body && body.duplicate === true) return 'duplicate';
    if (body && body.pending === true) return 'pending';
    if (body && body.ignored === true) return 'ignored';
    if (body && typeof body.warn === 'string') return 'warned';
    return 'accepted';
}

export const enabled = (env = process.env) => env.WEBHOOK_DELIVERY_LOG_ENABLED === 'true';

/**
 * @param {string} source      jobs.provider / webhook_events.source name, e.g. 'fal', 'stripe'
 * @param {(req: Request) => Promise<Response>} handler
 * @param {{ record?: typeof recordDelivery }} [deps]
 */
export function withDeliveryLog(source, handler, deps = {}) {
    const record = deps.record || recordDelivery;
    return async function POST(req) {
        const res = await handler(req);
        if (!enabled()) return res;
        let body = null;
        try { body = await res.clone().json(); } catch { body = null; }
        const error = body && typeof body.error === 'string' ? body.error : body && typeof body.warn === 'string' ? `warn:${body.warn}` : null;
        await record({ source, outcome: classify(res.status, body), status: res.status, error }).catch(() => {});
        return res;
    };
}

/** Write the row; a failure is logged and swallowed. */
export async function recordDelivery({ source, outcome, status, error }, cfg = envConfig(), fetcher = fetchWithTimeout) {
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return;
    try {
        const res = await fetcher(new URL('/rest/v1/rpc/record_webhook_delivery', cfg.supabaseUrl), {
            method: 'POST',
            headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_source: source, p_outcome: outcome, p_http_status: status, p_error: error && ERROR_RE.test(error) ? error : null }),
        }, RECORD_TIMEOUT_MS);
        if (!res.ok) console.error('[webhook-delivery] record failed', source, res.status);
    } catch (err) {
        console.error('[webhook-delivery] record failed', source, err && err.message);
    }
}
