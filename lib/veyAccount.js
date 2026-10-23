// Vey explains the signed-in user's own recent charges (ADR-0103).
//
// The server reads one account's rows, keyed by the middleware-verified auth id; the model has no tool, no id and
// no query, and in v1 receives none of this data: the answer is a template. Only categories leave the ledger
// (`ledgerKind`), never the operator's reason, and nothing here writes.

import { rpc, select } from '../packages/db/supabase-client.js';
import { ledgerKind } from './ledgerKind.js';
import { SUPPORT_EMAIL } from './productKnowledge.js';

export const ACCOUNT_LEDGER_ROWS = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exact "true" only: absence is off, which production relies on (it has no spare Worker text binding). */
export const veyAccountEnabled = (env) => !!env && env.VEY_ACCOUNT_ENABLED === 'true';

/** Only questions about a charge or the balance read the ledger; how-to questions never do. */
export function helpNeedsAccount(question) {
    const text = String(question || '');
    return /\b(why|what)\b.*\b(charged|charge|deducted|taken|debited|spent|cost me)\b/i.test(text)
        || /\b(i was|was i|been|got|am i being|did you) (charged|deducted|billed|debited)\b/i.test(text)
        || /\b(my|current) (credit )?balance\b/i.test(text)
        || /\bhow many credits (do i have|have i got|are left|left)\b/i.test(text)
        || /\bwhere (did|have) my credits (go|gone)\b/i.test(text)
        || /\bmy (last|latest|recent) (charge|charges|credits? movement|transaction|transactions)\b/i.test(text);
}

/**
 * One account's balance and latest ledger entries as categories. Returns
 * `{ balance, freeCredits, freeExpiresAt, entries: [{kind, delta, freeDelta, at, model, state}] }`.
 * Throws on a read failure; the caller says so instead of inventing a charge.
 */
export async function readAccountSnapshot(authId, cfg, { rpcImpl = rpc, selectImpl = select } = {}) {
    if (!UUID.test(String(authId || ''))) throw new Error('invalid_auth_id');
    const credits = await rpcImpl('read_user_credits', { p_auth_id: authId }, cfg);
    const snapshot = {
        balance: Number(credits?.balance) || 0,
        freeCredits: Number(credits?.free_credits) || 0,
        freeExpiresAt: credits?.free_expires_at || null,
        entries: [],
    };
    const users = await selectImpl('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg);
    const userId = users?.[0]?.id;
    if (!userId || !UUID.test(userId)) return snapshot;
    const rows = await selectImpl('ledger_entries', {
        columns: 'id,delta,free_delta,reason,job_id,created_at',
        filter: `user_id=eq.${userId}&order=created_at.desc,id.desc`,
        limit: ACCOUNT_LEDGER_ROWS,
    }, cfg);
    const jobIds = [...new Set((rows || []).map((row) => row.job_id).filter((id) => UUID.test(String(id || ''))))];
    const jobs = new Map();
    if (jobIds.length) {
        const found = await selectImpl('jobs', {
            columns: 'id,model_id,state',
            filter: `user_id=eq.${userId}&id=in.(${jobIds.join(',')})`,
            limit: jobIds.length,
        }, cfg);
        for (const job of found || []) jobs.set(job.id, job);
    }
    snapshot.entries = (rows || []).map((row) => {
        const job = jobs.get(row.job_id);
        return {
            kind: ledgerKind(row.reason, row.delta),
            delta: Number(row.delta) || 0,
            freeDelta: Number(row.free_delta) || 0,
            at: row.created_at,
            model: job ? String(job.model_id || '').slice(0, 100) : '',
            state: job ? String(job.state || '') : '',
        };
    });
    return snapshot;
}

const KIND_LABEL = Object.freeze({
    generation: 'a generation',
    generation_refund: 'a refund for a failed generation',
    top_up: 'a Credit Pack purchase',
    signup_grant: 'your sign-up Credits',
    free_credit_expiry: 'free Credits expiring',
    referral_reward: 'a referral reward',
    checkin_reward: 'a daily check-in reward',
    referral_reward_reversed: 'a referral reward reversed',
    payment_adjustment: 'a payment adjustment',
    adjustment: 'an adjustment',
});

const day = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const credits = (n) => `${Math.abs(n)} Credit${Math.abs(n) === 1 ? '' : 's'}`;

function describe(entry) {
    const label = KIND_LABEL[entry.kind] || KIND_LABEL.adjustment;
    const sign = entry.delta < 0 ? 'charged' : 'added';
    const model = entry.model ? ` (${entry.model})` : '';
    const when = day(entry.at);
    return `${credits(entry.delta)} ${sign} for ${label}${model}${when ? `, ${when}` : ''}`;
}

/**
 * A plain-language answer built only from the rows. It never claims more than they show,
 * and says what it cannot see (why a refund was not issued, payments, other accounts).
 */
export function accountAnswerPlan(snapshot) {
    const parts = [`Your balance is ${snapshot.balance} Credits${snapshot.freeCredits ? `, of which ${snapshot.freeCredits} are free` : ''}.`];
    if (!snapshot.entries.length) {
        parts.push('Nothing has moved on your account yet.');
    } else {
        parts.push(`Latest: ${snapshot.entries.slice(0, 3).map(describe).join('; ')}.`);
        const refunded = snapshot.entries.find((entry) => entry.kind === 'generation_refund');
        if (refunded) parts.push('A failed generation shows as its own refund line.');
    }
    parts.push(`The Credits statement lists the rest. I cannot see payments or why a refund was not issued; email ${SUPPORT_EMAIL} for that.`);
    return { message: parts.join(' ').slice(0, 700), target: 'credits.statement', action: 'show_target' };
}

/** Said when the read fails or the flag-gated read is unavailable: never a guessed charge. */
export function accountUnavailablePrefix() {
    return 'I could not read your account just now, so I cannot say what was charged. ';
}
