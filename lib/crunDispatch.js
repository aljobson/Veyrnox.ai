import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { submitTask } from '../packages/adapters/crun.js';
import { submitCrunAtBoundary } from './crunSubmitBoundary.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function crunDispatchRuntime(env) {
    const cfg = { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
    if (env.CRUN_ENABLED !== 'true' || !env.CRUN_API_KEY || !cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return { ok: false, skipped: 'not_configured' };
    }
    return { ok: true, cfg, apiKey: env.CRUN_API_KEY };
}

export function validCrunClaim(job) {
    return UUID_RE.test(String(job?.job_id || '')) && UUID_RE.test(String(job?.attempt_token || ''))
        && job.endpoint === 'crun:suno/music-generate'
        && job.payload?.model === 'suno/music-generate'
        && job.payload.input && typeof job.payload.input === 'object' && !Array.isArray(job.payload.input);
}

export const crunDeferredRetrySeconds = (attemptCount, requested) => Math.max(
    Math.min(600, 30 * (2 ** Math.max(0, Math.min(10, Number(attemptCount) || 0)))),
    Math.max(1, Math.min(600, Number(requested) || 0)),
);

/** One paid call after a fenced STARTED claim; only evidence writes may retry. */
export async function runCrunDispatchAttempt(job, runtime, {
    rpc = realRpc, submit = submitTask, boundary = submitCrunAtBoundary,
} = {}) {
    let answer;
    try {
        answer = await boundary({
            job_id: job.job_id,
            provider_endpoint: job.endpoint,
            inputs: job.payload.input,
        }, {
            apiKey: runtime.apiKey,
            cfg: runtime.cfg,
            reservationKey: `music:${job.attempt_token}`,
            purpose: 'music.create',
            rpc,
            submit,
        });
    } catch {
        answer = { ok: false, outcome: 'unknown', errorCode: 'provider_unreachable' };
    }
    const outcome = answer?.ok ? 'ACCEPTED'
        : answer?.localLimit ? 'READY'
            : answer?.scope === 'deferred' ? 'DEFERRED'
            : ['account', 'route', 'model', 'circuit'].includes(answer?.scope) ? 'READY'
                : answer?.outcome === 'rejected' ? 'REJECTED' : 'UNKNOWN';
    const failureCode = answer?.errorCode && /^[a-z0-9_]{1,64}$/.test(answer.errorCode)
        ? answer.errorCode : outcome === 'UNKNOWN' ? 'provider_outcome_unknown' : 'provider_submit_failed';
    const args = {
        p_job_id: job.job_id,
        p_attempt_token: job.attempt_token,
        p_outcome: outcome,
        p_provider_job_id: outcome === 'ACCEPTED' ? answer.providerJobId : null,
        p_failure_code: outcome === 'ACCEPTED' ? null : failureCode,
        p_retry_after_seconds: outcome === 'DEFERRED'
            ? crunDeferredRetrySeconds(job.attempt_count, answer?.retryAfterSeconds) : null,
    };
    let recorded = false;
    for (let attempt = 0; attempt < 2 && !recorded; attempt += 1) {
        try { recorded = (await rpc('record_crun_dispatch', args, runtime.cfg))?.ok === true; }
        catch { /* retry identical evidence, never CreateTask */ }
    }
    if (!recorded || outcome === 'UNKNOWN') {
        console.error(JSON.stringify({ event: 'crun.dispatch_evidence_alert', job_id: job.job_id,
            attempt_token: job.attempt_token, outcome,
            ...(outcome === 'ACCEPTED' ? { provider_job_id: answer.providerJobId } : {}) }));
    }
    let recovered = false;
    try {
        const recovery = await rpc('recover_crun_dispatch', { p_limit: 10 }, runtime.cfg);
        recovered = true;
        if (recovery?.ok !== true) console.error(JSON.stringify({ event: 'crun.dispatch_recovery_partial',
            failed: Number(recovery?.failed) || 1 }));
    }
    catch { /* the minute backstop will retry evidence recovery */ }
    if (!recovered) console.error(JSON.stringify({ event: 'crun.dispatch_recovery_failed', job_id: job.job_id }));
    return { ok: recorded && recovered && outcome !== 'UNKNOWN', recorded, recovered, outcome };
}

/** Per-minute durable backstop. Lost claim acknowledgements are never reclaimed. */
export async function runCrunDispatch(env, {
    rpc = realRpc, submit = submitTask, boundary = submitCrunAtBoundary, now = Date.now,
} = {}) {
    const runtime = crunDispatchRuntime(env);
    if (!runtime.ok) return runtime;
    const deadline = now() + 45_000;
    try {
        const recovered = await rpc('recover_crun_dispatch', { p_limit: 25 }, runtime.cfg);
        if (recovered?.ok !== true) console.error(JSON.stringify({ event: 'crun.dispatch_recovery_partial',
            failed: Number(recovered?.failed) || 1 }));
    } catch {
        console.error(JSON.stringify({ event: 'crun.dispatch_recovery_failed' }));
    }
    let submitted = 0, failed = 0;
    while (submitted < 20 && now() < deadline - 5_000) {
        const claim = await rpc('claim_crun_dispatch', {}, runtime.cfg);
        if (!claim) break;
        if (claim.held === true) break;
        if (!validCrunClaim(claim)) {
            failed += 1;
            console.error(JSON.stringify({ event: 'crun.dispatch_claim_invalid' }));
            if (UUID_RE.test(String(claim.job_id || '')) && UUID_RE.test(String(claim.attempt_token || ''))) {
                try {
                    await rpc('record_crun_dispatch', {
                        p_job_id: claim.job_id,
                        p_attempt_token: claim.attempt_token,
                        p_outcome: 'REJECTED',
                        p_provider_job_id: null,
                        p_failure_code: 'dispatch_payload_invalid',
                        p_retry_after_seconds: null,
                    }, runtime.cfg);
                } catch {
                    console.error(JSON.stringify({ event: 'crun.dispatch_invalid_claim_record_failed',
                        job_id: claim.job_id }));
                }
            }
            break;
        }
        submitted += 1;
        const result = await runCrunDispatchAttempt(claim, runtime, { rpc, submit, boundary });
        if (!result.ok) failed += 1;
        if (!result.recorded || !result.recovered) break;
        // READY is circuit-held work. Without this guard an unavailable
        // account could be reclaimed repeatedly inside one cron invocation.
        if (result.outcome === 'READY') break;
    }
    const result = { ok: failed === 0, submitted, failed };
    try { await rpc('record_worker_task_health', { p_task: 'crun_dispatch', p_ok: result.ok }, runtime.cfg); }
    catch { console.error(JSON.stringify({ event: 'crun.dispatch_health_record_failed' })); }
    return result;
}
