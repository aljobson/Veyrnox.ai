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

const ACCEPTABLE_USE_URL = 'https://veyrnox.ai/legal/aup';
// The third Takedown Freezes the account (0146).
const TAKEDOWNS_BEFORE_FREEZE = 3;

/**
 * @param {{ tier: 'warning' | 'takedown', takedowns?: number, frozen?: boolean }} action
 * @returns {{ subject: string, text: string }}
 */
export function violationEmail({ tier, takedowns = 0, frozen = false }) {
    const sign = `Reply to this email if you think this was a mistake.\n\nVeyrnox.ai`;
    if (tier === 'warning') {
        return {
            subject: 'A warning about content on your Veyrnox.ai account',
            text: `We reviewed content generated on your Veyrnox.ai account and found that it broke our Acceptable Use Policy:\n${ACCEPTABLE_USE_URL}\n\n`
                + `This is a warning. Nothing has been removed and your account works as before. Repeated breaches can lead to content being removed and the account being frozen.\n\n${sign}`,
        };
    }
    const remaining = Math.max(TAKEDOWNS_BEFORE_FREEZE - takedowns, 0);
    const consequence = frozen
        ? 'This was the third removal on your account, so the account is now frozen. You can sign in, but you cannot generate or buy credits.'
        : `This is removal ${takedowns} of ${TAKEDOWNS_BEFORE_FREEZE}. ${remaining === 1 ? 'One more' : `${remaining} more`} will freeze the account.`;
    return {
        subject: frozen ? 'Your Veyrnox.ai account has been frozen' : 'Content was removed from your Veyrnox.ai account',
        text: `We removed a generation from your Veyrnox.ai account because it broke our Acceptable Use Policy:\n${ACCEPTABLE_USE_URL}\n\n`
            + `Its files have been deleted and can no longer be opened from your Library.\n\n${consequence}\n\n${sign}`,
    };
}

/**
 * @param {{ cfg: object, userId: string, actionId: string, tier: 'warning' | 'takedown',
 *   takedowns?: number, frozen?: boolean, env?: Record<string, string | undefined>,
 *   deps?: { select: typeof select, sendEmail: typeof sendEmail } }} args
 * @returns {Promise<'sent' | 'skipped' | 'failed'>}
 */
export async function notifyViolation({ cfg, userId, actionId, tier, takedowns, frozen, env = process.env, deps = { select, sendEmail } }) {
    const mail = resendConfig(env);
    if (!isConfigured(mail)) return 'skipped';
    try {
        const rows = await deps.select('users', { columns: 'email', filter: `id=eq.${encodeURIComponent(userId)}`, limit: 1 }, cfg);
        const to = Array.isArray(rows) && rows[0] && rows[0].email;
        if (!to) {
            console.error('[violation-email] no address for user', userId);
            return 'failed';
        }
        const { subject, text } = violationEmail({ tier, takedowns, frozen });
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
