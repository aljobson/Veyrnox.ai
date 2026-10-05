// ADR-0069: take a free allowance before the paid debit. Shared by /api/v1/generations and the chat turn so the
// two paths cannot drift. The database decides (submit_free_job, migration 0206); this only asks and maps.
import { rpc as realRpc } from '../packages/db/supabase-client.js';

/** The one switch. Off (the default) means no allowance column is read and no free call is ever made. */
export const freeAllowanceOn = (env) => !!env && env.FREE_ALLOWANCE_ENABLED === 'true';

// The spendable balance for a job that cost nothing: the client shows it, so it must never come back empty.
async function balanceAfterFree(rpc, authId, cfg) {
    try {
        const credits = await rpc('read_user_credits', { p_auth_id: authId }, cfg);
        const n = Number(credits && credits.balance);
        return Number.isFinite(n) ? n : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Try to take a free allowance for this job.
 *   - a free job was created      -> { ok: true, job_id, idempotent, free: true, balance_after }
 *   - a refusal the paid debit would also give (rate limit, Frozen, no balance row) -> that refusal ({ ok: false, ... })
 *   - nothing free (used up, budget spent, not eligible, no allowance) or the call itself failed -> null: the caller
 *     runs the normal debit at the catalog price. If the call failed after the job was created, that debit finds the
 *     job by idempotency key, so a free job is never created twice or charged.
 */
export async function takeFreeJob({ rpc = realRpc, cfg, authId, userId, key, modelId, inputs, limit, windowSeconds }) {
    try {
        const free = await rpc('submit_free_job', {
            p_user_id: userId, p_idempotency_key: key, p_model_id: modelId, p_inputs: inputs,
            p_limit_per_window: limit, p_window_seconds: windowSeconds,
        }, cfg);
        if (free && free.ok === false) return free;
        if (free && free.ok === true && free.taken === true) {
            return { ok: true, job_id: free.job_id, idempotent: free.idempotent === true, free: true, balance_after: await balanceAfterFree(rpc, authId, cfg) };
        }
    } catch (err) {
        console.error('[free-allowance] submit_free_job failed:', err && err.message);
    }
    return null;
}
