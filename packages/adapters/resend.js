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
const FILE_RE = /^[A-Za-z0-9._-]{1,100}$/;
const DEFAULT_REPORT_FROM = 'Veyrnox Reports <support@veyrnox.ai>';
const DEFAULT_REPORT_REPLY_TO = 'support@veyrnox.ai';

/** @param {Record<string, string | undefined>} [env] */
export function resendConfig(env = process.env) {
    return { apiKey: env.RESEND_API_KEY, from: env.VIOLATION_EMAIL_FROM, replyTo: env.VIOLATION_EMAIL_REPLY_TO };
}

/** Dedicated sender for analytics reports; never silently borrows the violation sender. */
export function reportResendConfig(env = process.env) {
    return {
        apiKey: env.RESEND_API_KEY,
        from: env.REPORT_EMAIL_FROM || DEFAULT_REPORT_FROM,
        replyTo: env.REPORT_EMAIL_REPLY_TO || DEFAULT_REPORT_REPLY_TO,
    };
}

export function isConfigured(cfg) {
    return Boolean(cfg && cfg.apiKey && typeof cfg.from === 'string' && FROM_RE.test(cfg.from));
}

/**
 * Sends one plain-text email. `idempotencyKey` makes a retry of the same
 * send a no-op at Resend. Never throws: returns { ok: true, id } or
 * { ok: false, error } with a short code, not the provider's payload.
 *
 * A `replyTo` that is not a plain address is left out, so replies go to `from`.
 *
 * @param {{ apiKey?: string, from?: string, replyTo?: string }} cfg
 * @param {{ to: string, subject: string, text: string, idempotencyKey: string, replyTo?: string,
 *   attachments?: {filename:string,content:string}[] }} message
 */
export async function sendEmail(cfg, { to, subject, text, idempotencyKey, replyTo: messageReplyTo, attachments }, fetcher = fetchWithTimeout) {
    if (!isConfigured(cfg)) return { ok: false, error: 'not_configured' };
    if (typeof to !== 'string' || !TO_RE.test(to)) return { ok: false, error: 'invalid_recipient' };
    if (typeof idempotencyKey !== 'string' || !KEY_RE.test(idempotencyKey)) return { ok: false, error: 'invalid_idempotency_key' };
    const selectedReplyTo = typeof messageReplyTo === 'string' && TO_RE.test(messageReplyTo) ? messageReplyTo
        : typeof cfg.replyTo === 'string' && TO_RE.test(cfg.replyTo) ? cfg.replyTo : null;
    const replyTo = selectedReplyTo ? { reply_to: selectedReplyTo } : {};
    const files = attachments == null ? [] : attachments;
    if (!Array.isArray(files) || files.length > 3 || files.some((file) => !file || !FILE_RE.test(file.filename)
        || typeof file.content !== 'string' || file.content.length > 7_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content))) {
        return { ok: false, error: 'invalid_attachment' };
    }
    let res;
    try {
        res = await fetcher(RESEND_EMAILS_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({ from: cfg.from, to: [to], subject, text, ...replyTo,
                ...(files.length ? { attachments: files } : {}) }),
        }, TIMEOUT_MS);
    } catch {
        return { ok: false, error: 'unreachable' };
    }
    if (!res.ok) return { ok: false, error: `resend_${res.status}` };
    let body = null;
    try { body = await res.json(); } catch { /* an id is useful, not required */ }
    return { ok: true, id: body && typeof body.id === 'string' ? body.id : null };
}
