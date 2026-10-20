/**
 * The email a user gets when their content is given a Content Warning or a
 * Takedown (ADR-0058 decision 7, issue #479). Sent through Resend, and only
 * when RESEND_API_KEY and VIOLATION_EMAIL_FROM are both set.
 *
 * The admin's reason is an internal note and is never put in the email, and
 * neither is any prompt or generated content. A failed send is logged and
 * reported to the admin; it never undoes the recorded action.
 */

import { select } from '../packages/db/supabase-client.js';
import { resendConfig, isConfigured, sendEmail } from '../packages/adapters/resend.js';

export { renderViolation as violationEmail, renderAppeal as appealEmail } from './i18n/email.mjs';
import { renderViolation, renderAppeal } from './i18n/email.mjs';

/**
 * @param {{ cfg: object, userId: string, actionId: string, tier: 'warning' | 'takedown',
 *   takedowns?: number, frozen?: boolean, env?: Record<string, string | undefined>,
 *   deps?: { select: typeof select, sendEmail: typeof sendEmail } }} args
 * @returns {Promise<'sent' | 'skipped' | 'failed'>}
 */
export async function notifyViolation({ cfg, userId, actionId, tier, takedowns, frozen, holdUntil = null, env = process.env, deps = { select, sendEmail } }) {
    return send({ cfg, userId, actionId, env, deps, mail: locale => renderViolation({ tier, takedowns, frozen, holdUntil }, locale) });
}

/**
 * @param {{ cfg: object, userId: string, actionId: string, decision: 'upheld' | 'rejected', appealedAction?: string,
 *   unfrozen?: boolean, holdUntil?: string | null, env?: Record<string, string | undefined>,
 *   deps?: { select: typeof select, sendEmail: typeof sendEmail } }} args
 * @returns {Promise<'sent' | 'skipped' | 'failed'>}
 */
export async function notifyAppealDecision({ cfg, userId, actionId, decision, appealedAction, unfrozen, holdUntil = null, env = process.env, deps = { select, sendEmail } }) {
    return send({ cfg, userId, actionId, env, deps, mail: locale => renderAppeal({ decision, appealedAction, unfrozen, holdUntil }, locale) });
}

async function send({ cfg, userId, actionId, env, deps, mail: compose }) {
    const mail = resendConfig(env);
    if (!isConfigured(mail)) return 'skipped';
    try {
        let rows;
        const query = { columns: 'email,preferred_locale', filter: `id=eq.${encodeURIComponent(userId)}`, limit: 1 };
        try { rows = await deps.select('users', query, cfg); }
        catch (error) {
            // Before the migration, still send the original English notice.
            let body = error?.body;
            if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
            if (!['42703', 'PGRST204'].includes(body?.code) || !String(body?.message).includes('preferred_locale')) throw error;
            rows = await deps.select('users', { ...query, columns: 'email' }, cfg);
        }
        const to = Array.isArray(rows) && rows[0] && rows[0].email;
        if (!to) {
            console.error('[violation-email] no address for user', userId);
            return 'failed';
        }
        const { subject, text } = compose(rows[0].preferred_locale);
        // One email per recorded action: a retry reuses the key and Resend drops it.
        const sent = await deps.sendEmail(mail, { to, subject, text, idempotencyKey: `violation-${actionId}` });
        if (!sent.ok) {
            console.error('[violation-email] send failed for action', actionId, sent.error);
            return 'failed';
        }
        return 'sent';
    } catch (err) {
        console.error('[violation-email] failed for action', actionId, err && err.message);
        return 'failed';
    }
}
