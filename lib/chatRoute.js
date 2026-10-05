/**
 * Shared front door for the chat routes (ADR-0067): who is calling, is Chat open, and the shared durable
 * read limit (consume_account_read_request, the bucket other account routes use). Returns either
 * { authId, cfg } or a Response to send back as is.
 */

import { rpc, envConfig } from '../packages/db/supabase-client.js';
import { chatEnabled, UUID_RE } from './chat.js';

export const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

// How a database refusal reads to the client. Anything unlisted is a 400 with the code lower-cased.
const STATUS = {
    USER_NOT_FOUND: 409, THREAD_NOT_FOUND: 404, MODEL_NOT_FOUND: 404, THREAD_LIMIT: 409, INVALID_INPUT: 400, BAD_STATE: 409, JOB_NOT_FOUND: 404,
};
export function refusal(result) {
    const code = result && typeof result.code === 'string' ? result.code : 'REQUEST_FAILED';
    const error = code === 'USER_NOT_FOUND' ? 'user_not_provisioned' : code.toLowerCase();
    return reply({ error }, STATUS[code] || 400);
}

/** @param {Request} req @param {{readLimit?:boolean}} [opts] readLimit: count this request against the shared read bucket */
export async function enter(req, { readLimit = true } = {}) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!UUID_RE.test(authId || '')) return reply({ error: 'not_authenticated' }, 401);
    // Chat is dark until the owner opens it. Per request, never cached.
    if (!chatEnabled(process.env)) return reply({ error: 'chat_not_open' }, 503);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    if (readLimit) {
        try {
            const rate = await rpc('consume_account_read_request', { p_auth_id: authId }, cfg);
            if (rate && rate.code === 'RATE_LIMITED') {
                const seconds = Number.isInteger(rate.retry_after_seconds) ? Math.max(1, Math.min(60, rate.retry_after_seconds)) : 60;
                return reply({ error: 'rate_limited' }, 429, { 'Retry-After': String(seconds) });
            }
            if (rate && rate.code === 'NOT_FOUND') return reply({ error: 'user_not_provisioned' }, 409);
            if (!rate || rate.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
        } catch (err) {
            console.error('[chat] read limit errored:', err && err.message);
            return reply({ error: 'temporarily_unavailable' }, 503);   // fail closed
        }
    }
    return { authId, cfg };
}
