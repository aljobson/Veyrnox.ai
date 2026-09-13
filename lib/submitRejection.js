/**
 * A provider refused a submit: record why on the job, then refund it.
 *
 * `job_submit_rejected` stores a typed error_code on the still-DEBITED job so
 * the failure is diagnosable without a rerun (#117). It never blocks the
 * refund: a failure to record is logged and `ledger_refund` runs regardless,
 * with the same arguments as before. A refund that errors leaves the job
 * DEBITED for `sweep_stuck_jobs`.
 */

import { rpc } from '../packages/db/supabase-client.js';

// Same shape /api/v1/jobs lets through to the client. Anything else (fal and
// kie return log strings, not codes) is recorded as the generic code.
const ERROR_CODE_RE = /^[a-z0-9_]{1,64}$/;

/**
 * @param {{jobId:string, userId:string, credits:number, errorCode?:string}} job
 * @param {object} cfg Supabase config
 */
export async function refundRejectedSubmit({ jobId, userId, credits, errorCode }, cfg) {
    const code = ERROR_CODE_RE.test(String(errorCode || '')) ? errorCode : 'provider_submit_failed';
    try {
        const recorded = await rpc('job_submit_rejected', { p_job_id: jobId, p_error_code: code }, cfg);
        if (!recorded || recorded.ok !== true) {
            console.warn('[generations] job_submit_rejected returned', recorded && recorded.code);
        }
    } catch (err) {
        console.error('[generations] job_submit_rejected failed:', err);
    }
    try {
        await rpc('ledger_refund', {
            p_job_id: jobId,
            p_user_id: userId,
            p_credits: credits,
            p_reason: 'refund:submit_failed',
        }, cfg);
    } catch (err) {
        // Log — the job stays in DEBITED and the reconcile job will flag it.
        console.error('[generations] refund-on-submit-fail failed:', err);
    }
}
