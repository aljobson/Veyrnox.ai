/**
 * A ceiling on refunded composite jobs per account (audit 2026-10-09, M-07).
 *
 * A composite job (Clip Editor, Auto Short) is billed as one job but runs as
 * several provider steps. When a late step fails the parent is refunded in
 * full, and the steps already billed by the provider are our cost. Nothing
 * limited how many such refunds one account could run up: a clip that always
 * fails its captions step, or a scene a provider always refuses, could be
 * resubmitted at the rate limit all day.
 *
 * The gate asks the database (0251, refunded_jobs_recent) how many of the
 * account's composite jobs were refunded in the last rolling day, before any
 * money moves, and refuses the next one at the ceiling. The twenty-four hours
 * run from the refunded job's creation, so the account is open again a day
 * after the first of the run. A database without the function (before 0251
 * is applied) errors, and the job is admitted as it always was.
 */

export const COMPOSITE_MODELS = Object.freeze(['clip-edit', 'auto-short-32s']);
export const COMPOSITE_REFUNDS_PER_DAY = 5;
const RETRY_AFTER_SECONDS = 3600;

/**
 * @param {{rpc: Function, cfg: object, userId: string, modelId: string, limit?: number}} args
 * @returns {Promise<null|{status:number, body:{error:string, limit:number, count:number, retry_after_seconds:number}, retryAfter:number}>}
 *   null when the job may go ahead.
 */
export async function compositeRefundGate({ rpc, cfg, userId, modelId, limit = COMPOSITE_REFUNDS_PER_DAY }) {
    if (!COMPOSITE_MODELS.includes(modelId)) return null;
    let count;
    try {
        count = Number(await rpc('refunded_jobs_recent', { p_user_id: userId, p_model_ids: COMPOSITE_MODELS }, cfg));
    } catch (err) {
        console.error('[generations] refunded composite count errored, job admitted:', err && err.message);
        return null;
    }
    if (!Number.isFinite(count) || count < limit) return null;
    console.error('[generations] composite refund ceiling reached for user', userId, count);
    return {
        status: 429,
        body: { error: 'composite_refund_limit', limit, count, retry_after_seconds: RETRY_AFTER_SECONDS },
        retryAfter: RETRY_AFTER_SECONDS,
    };
}
