/**
 * Video agent orchestrator — slice 3 of docs/montage/SPEC.md (ADR-0074).
 *
 * One parent `jobs` row carries the single debit, moved with the existing
 * state RPCs under provider 'veyrnox' and provider_job_id `va_<job id>`, so no
 * provider webhook can match it (same device as lib/autoShort.js). The
 * isolated runner is one job_steps row (step 'montage', provider 'montage',
 * provider_job_id `mr_<job id>`, a name we choose, never one the runner sends).
 *
 *   start          parent DEBITED -> SUBMITTED; claim the step; ask the runner
 *                  to run; record the run id
 *   onStepOutcome  a verified runner result:
 *                    completed -> check the object the runner uploaded -> step
 *                                 STORED -> parent STORED with its asset
 *                    failed    -> step FAILED -> parent FAILED and refunded
 *
 * A failed run is never re-run: every run spends provider money up to its
 * ceiling, and ADR-0074 §3 refunds all-or-nothing. Every step is idempotent,
 * so a caller that errors may safely be called again with the same input.
 * All I/O comes in through `deps` (tests/montage.test.mjs).
 */

export const PARENT_PROVIDER = 'veyrnox';
export const STEP_PROVIDER = 'montage';
export const STEP_ENDPOINT = 'video-agent:v1';
export const STEP_NAME = 'montage';
export const TIMEOUT_MINUTES = 45;
export const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;

export const parentRef = (jobId) => `va_${jobId}`;
export const runRef = (jobId) => `mr_${jobId}`;
/** R2 key for the final video: server ids only, never a runner path. */
export const outputKey = (jobId) => `video-agent/${jobId}/final.mp4`;

const CODE_RE = /^[a-z0-9_]{1,64}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const code = (c, fallback) => (CODE_RE.test(String(c || '')) ? String(c) : fallback);

/**
 * @typedef {object} Deps
 * @property {(name:string, args:object) => Promise<any>} rpc
 * @property {(jobId:string) => Promise<{id:string,user_id:string,credits:number,state:string}|null>} job
 * @property {{run:(req:object)=>Promise<{ok:boolean,error?:string}>, cancel:(runId:string)=>Promise<any>}} runner
 * @property {(key:string) => Promise<{ok:boolean, size?:number, error?:string}>} head   object size in R2, ok:false+error:'missing' when absent
 */

/** Fail the parent and refund it once. Safe to repeat. */
export async function failParent(jobId, errorCode, deps) {
    const failed = await deps.rpc('job_failed', {
        p_provider_job_id: parentRef(jobId), p_provider: PARENT_PROVIDER, p_error_code: code(errorCode, 'video_agent_failed'),
    });
    let owed = failed && failed.ok ? { user_id: failed.user_id, credits: failed.credits } : null;
    if (!owed) {
        const job = await deps.job(jobId);
        if (!job || job.state !== 'FAILED') return { ok: false, code: 'parent_not_failable' };
        owed = job;
    }
    const refund = await deps.rpc('ledger_refund', {
        p_job_id: jobId, p_user_id: owed.user_id, p_credits: owed.credits, p_reason: 'refund:provider_failed',
    });
    if (!refund || refund.ok !== true) throw new Error(`video-agent refund rejected: ${refund && refund.code}`);
    return { ok: true, failed: true };
}

async function failStep(jobId, errorCode, deps) {
    await deps.rpc('job_step_failed', { p_job_id: jobId, p_step: STEP_NAME, p_ordinal: 0, p_error_code: code(errorCode, 'runner_failed') });
}

/**
 * Kick off a debited video-agent job. `brief`, `planId` and `aspect` have
 * passed the capability record and the plan check at the gateway.
 * @returns {Promise<{ok:boolean, failed?:boolean, raced?:boolean, error?:string}>}
 */
export async function start({ jobId, brief, planId, aspect }, deps) {
    const sub = await deps.rpc('job_submitted', { p_job_id: jobId, p_provider: PARENT_PROVIDER, p_provider_job_id: parentRef(jobId) });
    if (!sub || !sub.ok) return { ok: false, error: 'parent_not_submittable' };

    // Claim before spending: UNIQUE (job_id, step, ordinal) settles a race and
    // the loser never calls the runner (#230).
    const claim = await deps.rpc('job_step_claim', {
        p_job_id: jobId, p_step: STEP_NAME, p_ordinal: 0, p_provider: STEP_PROVIDER, p_provider_endpoint: STEP_ENDPOINT,
    });
    if (!claim || claim.ok !== true) {
        const error = String((claim && claim.code) || 'step_not_claimable').toLowerCase();
        return { ...(await failParent(jobId, error, deps)), error };
    }
    if (claim.claimed !== true) return { ok: true, raced: true };

    const runId = runRef(jobId);
    const sent = await deps.runner.run({ job_id: jobId, run_id: runId, brief, plan_id: planId, aspect_ratio: aspect });
    if (!sent || !sent.ok) {
        // No answer is not a refusal: on a timeout or a 5xx the runner may have accepted the run (its /run answers
        // 202 and works in a thread), and it would spend to its ceiling and hold the only slot for a job we refund.
        // So every failed start is cancelled. A 4xx the runner chose (400, 401, 429) means nothing started, but a
        // proxy in front of it can answer too, and a cancel for a run the runner never saw is a 200 no-op.
        // Sent first, awaited last: an unreachable runner holds the cancel for its full timeout and the refund
        // must not wait on that, nor be skipped when it fails.
        const stopped = deps.runner.cancel(runId).catch((err) => console.error('[video-agent] cancel failed:', err && err.message));
        try {
            await failStep(jobId, 'runner_submit_failed', deps);
            return { ...(await failParent(jobId, 'runner_submit_failed', deps)), error: 'runner_submit_failed' };
        } finally {
            await stopped;
        }
    }
    const rec = await deps.rpc('job_step_submitted', {
        p_job_id: jobId, p_step: STEP_NAME, p_ordinal: 0,
        p_provider: STEP_PROVIDER, p_provider_endpoint: STEP_ENDPOINT, p_provider_job_id: runId,
    });
    if (!rec || !rec.ok) {
        // The runner is already spending: stop it before refunding.
        await deps.runner.cancel(runId).catch((err) => console.error('[video-agent] cancel failed:', err && err.message));
        await failStep(jobId, 'step_not_recorded', deps);
        return { ...(await failParent(jobId, 'step_not_recorded', deps)), error: 'step_not_recorded' };
    }
    return { ok: true };
}

/**
 * A verified runner outcome for the job's montage step. The row came from our
 * (provider, provider_job_id) lookup; nothing here reads an id from a payload.
 * @param {{step:object, outcome:{state:'success', bytes:number, sha256:string}|{state:'fail', errorCode?:string}}} args
 */
export async function onStepOutcome({ step, outcome }, deps) {
    const jobId = step.job_id;
    if (step.state !== 'SUBMITTED') return { ok: true, replay: true };
    // A parent that already failed (and was refunded) or finished takes no more work.
    const parent = await deps.job(jobId);
    if (!parent || parent.state !== 'SUBMITTED') return { ok: true, parentDone: true };

    if (outcome.state !== 'success') {
        await failStep(jobId, outcome.errorCode, deps);
        return failParent(jobId, 'montage_failed', deps);
    }

    const key = outputKey(jobId);
    const bytes = Number(outcome.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_OUTPUT_BYTES || !SHA_RE.test(String(outcome.sha256 || ''))) {
        await failStep(jobId, 'output_invalid', deps);
        return failParent(jobId, 'output_invalid', deps);
    }
    const seen = await deps.head(key);
    // A transport error is retryable (the runner redelivers); an absent or
    // wrong-sized object is a failed run.
    if (!seen.ok && seen.error !== 'missing') return { ok: false, error: 'asset_check_failed', detail: seen.error };
    if (!seen.ok || seen.size !== bytes) {
        await failStep(jobId, 'output_missing', deps);
        return failParent(jobId, 'output_missing', deps);
    }

    const stored = await deps.rpc('job_step_stored', {
        p_job_id: jobId, p_step: STEP_NAME, p_ordinal: 0, p_provider: STEP_PROVIDER,
        p_provider_endpoint: STEP_ENDPOINT, p_output_r2_key: key, p_output_text: null,
    });
    if (!stored || !stored.ok) return { ok: false, error: 'step_not_recorded' };
    const done = await deps.rpc('job_stored', {
        p_provider_job_id: parentRef(jobId), p_provider: PARENT_PROVIDER,
        p_r2_key: key, p_mime_type: 'video/mp4', p_size_bytes: bytes, p_sha256: outcome.sha256,
    });
    return done && done.ok ? { ok: true, stored: true } : { ok: false, error: 'parent_not_stored' };
}
