/**
 * How a job row reads to its owner. One mapping, used by every route that answers with a job, so two routes can never
 * say different things about the same job (GET /api/v1/jobs/:id, POST /api/v1/chat/sends/close).
 *
 * DB → UI state (kept here so the UI stays honest with the ledger):
 *   PRICED, DEBITED, FAILOVER   → queued  (nothing user-visible yet)
 *   SUBMITTED, SUCCEEDED        → running (provider working / asset copying to R2 — no asset row until STORED)
 *   STORED                      → succeeded
 *   FAILED, REFUNDED            → failed  (`refunded` carries the money fact)
 */

/** Every state a job row can hold (job_state, packages/db/schema/0001_initial.sql). */
export const JOB_STATES = Object.freeze(['PRICED', 'DEBITED', 'FAILOVER', 'SUBMITTED', 'SUCCEEDED', 'STORED', 'FAILED', 'REFUNDED']);

/** @param {string} dbState @returns {'queued'|'running'|'succeeded'|'failed'} */
export function publicJobState(dbState) {
    switch (dbState) {
        case 'PRICED':
        case 'DEBITED':
        case 'FAILOVER':
            return 'queued';
        case 'SUBMITTED':
        case 'SUCCEEDED':
            return 'running';
        case 'STORED':
            return 'succeeded';
        // Both map to `failed` for the client's flow control; `refunded` carries the money fact.
        case 'FAILED':
        case 'REFUNDED':
            return 'failed';
        default:
            return 'queued';
    }
}

// Provider error codes are vendor strings; only our own short codes and a safe slug shape cross to the client.
const PUBLIC_ERROR_RE = /^[a-z0-9_]{1,64}$/;
/** @param {unknown} code @returns {string|undefined} */
export function publicErrorCode(code) {
    if (!code) return undefined;
    const s = String(code).toLowerCase();
    return PUBLIC_ERROR_RE.test(s) ? s : 'provider_error';
}

/**
 * The fields of a job its owner is shown.
 * @param {{state: string, credits: number, model_id: string, error_code?: string|null}} row as get_user_job returns it
 * @returns {{state: string, refunded: boolean, credits: number, model_id: string, error_code?: string}}
 */
export function publicJob(row) {
    return {
        state: publicJobState(row.state),
        // FAILED is not REFUNDED: job_failed settles the job, and the refund is a second call that can still be in
        // flight (or, before 0099, lost). The UI can say "credits refunded" only when the ledger says so.
        refunded: row.state === 'REFUNDED',
        credits: row.credits,
        model_id: row.model_id,
        error_code: publicErrorCode(row.error_code),
    };
}
