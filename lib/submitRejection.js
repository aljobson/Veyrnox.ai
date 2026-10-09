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

/** Record uncertainty without declaring failure or moving credits. */
export async function recordUnknownSubmit(jobId, cfg) {
    try {
        // This RPC only annotates an unsubmitted DEBITED job. Its historical
        // name does not imply a state transition; the timeout sweep still owns
        // the eventual refund if no provider handle can be recovered.
        const result = await rpc('job_submit_rejected', {
            p_job_id: jobId, p_error_code: 'provider_outcome_unknown',
        }, cfg);
        if (!result || result.ok !== true) {
            console.error('[generations] unknown submit annotation failed:', jobId, result?.code);
        }
    } catch {
        console.error('[generations] unknown submit annotation unavailable:', jobId);
    }
    console.error(JSON.stringify({ event: 'generation.submit_unknown', job_id: jobId }));
}

export async function unknownSubmitResponse(jobId, cfg) {
    await recordUnknownSubmit(jobId, cfg);
    return Response.json({ error: 'outcome_unknown', job_id: jobId }, {
        status: 503, headers: { 'Cache-Control': 'no-store' },
    });
}

/** A lost acknowledgement can hide a committed transition; never resubmit. */
export async function recordSubmittedJob({ jobId, provider, providerJobId }, cfg) {
    try {
        const recorded = await rpc('job_submitted', {
            p_job_id: jobId, p_provider: provider, p_provider_job_id: providerJobId,
        }, cfg);
        if (recorded?.ok === true) return true;
        console.error('[generations] job_submitted refused:', jobId, recorded?.code);
    } catch {
        console.error('[generations] job_submitted unavailable:', jobId);
    }
    console.error(JSON.stringify({ event: 'generation.submit_persistence_unknown',
        job_id: jobId, provider, provider_job_id: providerJobId }));
    return false;
}

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
