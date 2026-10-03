/**
 * Resend: transactional email over its HTTP API (owner decision 2026-10-03,
 * issue #479). Server-side only, plain fetch, no SDK. The key is a Worker
 * secret; the host is a constant.
 */

import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 8000;
// "Name <address@domain>" or a bare address.
const FROM_RE = /^(?:[^<>\r\n]{1,80} <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;
const TO_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** @param {Record<string, string | undefined>} [env] */
export function resendConfig(env = process.env) {
    return { apiKey: env.RESEND_API_KEY, from: env.VIOLATION_EMAIL_FROM };
}

export function isConfigured(cfg) {
    return Boolean(cfg && cfg.apiKey && typeof cfg.from === 'string' && FROM_RE.test(cfg.from));
}

/**
 * Sends one plain-text email. `idempotencyKey` makes a retry of the same
 * send a no-op at Resend. Never throws: returns { ok: true, id } or
 * { ok: false, error } with a short code, not the provider's payload.
 *
 * @param {{ apiKey?: string, from?: string }} cfg
 * @param {{ to: string, subject: string, text: string, idempotencyKey: string }} message
 */
export async function sendEmail(cfg, { to, subject, text, idempotencyKey }, fetcher = fetchWithTimeout) {
    if (!isConfigured(cfg)) return { ok: false, error: 'not_configured' };
    if (typeof to !== 'string' || !TO_RE.test(to)) return { ok: false, error: 'invalid_recipient' };
    if (typeof idempotencyKey !== 'string' || !KEY_RE.test(idempotencyKey)) return { ok: false, error: 'invalid_idempotency_key' };
    let res;
    try {
        res = await fetcher(RESEND_EMAILS_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({ from: cfg.from, to: [to], subject, text }),
        }, TIMEOUT_MS);
    } catch {
        return { ok: false, error: 'unreachable' };
    }
    if (!res.ok) return { ok: false, error: `resend_${res.status}` };
    let body = null;
    try { body = await res.json(); } catch { /* an id is useful, not required */ }
    return { ok: true, id: body && typeof body.id === 'string' ? body.id : null };
}
