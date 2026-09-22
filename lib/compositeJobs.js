/**
 * Composite jobs (ADR-0029): one debited parent job advanced through a plan of
 * provider calls (`job_steps`, migration 0091).
 *
 * A pipeline is registered per catalog model id:
 *   plan(inputs)            -> steps [{step, stage, ordinal, provider, provider_endpoint, params}]
 *   request(step, ctx)      -> provider inputs for that step (async). ctx gives the
 *                              parent job, every STORED step's output, and a presigner
 *                              for R2 keys, so a step reads its predecessors' outputs.
 *
 * The database owns every transition and every guard (one claim per ready
 * step, forward-only states, live-parent checks). This module only turns
 * claims into provider submits and callbacks into stored steps. The only
 * refund path is ledger_refund on the parent, at most once (it is idempotent
 * per job).
 */

import { rpc, select } from '../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, presignGetUrl } from '../packages/adapters/r2.js';
import { copyUrlToR2 } from '../packages/adapters/r2Copy.js';
import { submitJob as falSubmitJob } from '../packages/adapters/fal.js';
import { dedup, markProcessed } from './providerCompletion.js';

const PIPELINES = new Map();
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
// Presigned inputs only need to outlive the provider's fetch; measured queue
// wait is seconds (docs/editor/PRD.md §9). CLAUDE.md caps GETs at 15 min.
const INPUT_URL_TTL_S = 900;
// Copy failures a redelivery cannot fix: fail the step instead of retrying.
const NON_RETRYABLE_COPY = /^(source url invalid|source host not allowed|source too large|source [34]\d\d)$/;

export function registerPipeline(modelId, def) {
    if (typeof def?.plan !== 'function' || typeof def?.request !== 'function') {
        throw new Error(`pipeline ${modelId}: plan and request are required`);
    }
    PIPELINES.set(modelId, def);
}

export function pipelineFor(modelId) {
    return PIPELINES.get(modelId) || null;
}

/** Default wiring. Tests pass their own deps to makeEngine. */
function defaultDeps() {
    return {
        rpc,
        select,
        presign: (key) => presignGetUrl(key, INPUT_URL_TTL_S, r2EnvConfig()),
        copy: (url, key, opts) => copyUrlToR2(url, key, r2EnvConfig(), opts),
        dedup,
        markProcessed,
        submitters: {
            fal: async (step, inputs, env) => {
                const r = await falSubmitJob(
                    { job_id: step.id, provider_endpoint: step.provider_endpoint, inputs },
                    { falKey: env.falKey, webhookBaseUrl: new URL('/api/webhook/fal', env.publicHost).toString() },
                );
                return r.ok ? { ok: true, providerJobId: r.providerJobId } : { ok: false, error: r.error, retryable: !/^invalid/.test(String(r.error)) };
            },
        },
        pipelineFor,
    };
}

export function makeEngine(deps = defaultDeps()) {
    async function refundParent(cfg, failed, reason) {
        if (!failed || failed.retry || !failed.job_id) return;
        const r = await deps.rpc('ledger_refund', {
            p_job_id: failed.job_id, p_user_id: failed.user_id, p_credits: failed.credits, p_reason: reason,
        }, cfg);
        if (!r || r.ok !== true) {
            // The parent is FAILED; sweep_stuck_jobs' refund path cannot see a
            // FAILED job, so surface this loudly. ledger_refund is idempotent,
            // so a later retry of the same call is safe.
            console.error('[composite] ledger_refund rejected', failed.job_id, r && r.code);
            throw new Error('refund_failed');
        }
    }

    async function failStep(cfg, stepId, errorCode, retryable) {
        const failed = await deps.rpc('job_step_failed', {
            p_step_id: stepId, p_error_code: String(errorCode || 'step_failed').slice(0, 128), p_retryable: retryable,
        }, cfg);
        await refundParent(cfg, failed, 'refund:provider_failed');
        return failed;
    }

    /**
     * Submit every step that is ready now, or finalise a finished plan.
     * Safe to call any number of times from anywhere: the claim is atomic.
     */
    async function advance(jobId, cfg, env, depth = 0) {
        const claim = await deps.rpc('job_steps_claim_ready', { p_job_id: jobId }, cfg);
        if (!claim || claim.ok !== true) return { state: 'not_live' };
        if (claim.failed) return { state: 'failed' };
        if (claim.complete) {
            const done = await deps.rpc('job_composite_stored', { p_job_id: jobId }, cfg);
            return { state: done && done.ok ? 'stored' : 'store_pending', code: done && done.code };
        }
        const claimed = Array.isArray(claim.claimed) ? claim.claimed : [];
        if (!claimed.length) return { state: 'waiting' };

        const [job] = await deps.select('jobs', { columns: 'id,user_id,model_id,inputs', filter: `id=eq.${encodeURIComponent(jobId)}` }, cfg);
        const pipeline = job && deps.pipelineFor(job.model_id);
        const outputs = await deps.select('job_steps', {
            columns: 'id,step,stage,ordinal,output_r2_key,output_mime,output_text',
            filter: `job_id=eq.${encodeURIComponent(jobId)}&state=eq.STORED&order=stage.asc,ordinal.asc`,
        }, cfg);

        let retried = false;
        for (const step of claimed) {
            if (!pipeline) {
                await failStep(cfg, step.id, 'no_pipeline', false);
                continue;
            }
            const submit = deps.submitters[step.provider];
            if (!submit) {
                await failStep(cfg, step.id, 'no_submitter', false);
                continue;
            }
            let inputs;
            try {
                inputs = await pipeline.request(step, { job, outputs: outputs || [], presign: deps.presign });
            } catch (err) {
                console.error('[composite] request build failed', step.id, err && err.message);
                await failStep(cfg, step.id, 'request_build_failed', false);
                continue;
            }
            const sub = await submit(step, inputs, env);
            if (!sub.ok) {
                const f = await failStep(cfg, step.id, 'submit_failed', sub.retryable !== false);
                retried = retried || Boolean(f && f.retry);
                continue;
            }
            const rec = await deps.rpc('job_step_submitted', { p_step_id: step.id, p_provider_job_id: sub.providerJobId }, cfg);
            if (!rec || rec.ok !== true) {
                // Submitted at the provider but not recorded: its callback will
                // find no step and get a 409, and the sweep frees the claim.
                console.error('[composite] job_step_submitted rejected', step.id, rec && rec.code);
            }
        }
        // A retryable submit failure put its step back to PENDING; one more
        // pass resubmits it now. Bounded: a step has at most 2 attempts.
        if (retried && depth < 2) return advance(jobId, cfg, env, depth + 1);
        return { state: 'advanced', submitted: claimed.length };
    }

    /**
     * A signed, verified provider callback whose provider_job_id matched no
     * `jobs` row. Returns null when it matches no step either, so the webhook
     * can keep its "not ours yet, deliver again" answer.
     * @param {{source:string, providerJobId:string, isFail:boolean, outputUrl?:string|null,
     *          errorCode?:string, ext:string, copyOptions?:object}} cb
     */
    async function onStepCallback(cb, cfg, env) {
        if (!ID_RE.test(String(cb.providerJobId || ''))) return null;
        const [step] = await deps.select('job_steps', {
            columns: 'id,job_id,state,attempts',
            filter: `provider=eq.${encodeURIComponent(cb.source)}&provider_job_id=eq.${encodeURIComponent(cb.providerJobId)}&limit=1`,
        }, cfg) || [];
        if (!step) return null;

        const seen = await deps.dedup(cfg, cb.source, cb.providerJobId, { state: cb.isFail ? 'fail' : 'success', step: true });
        if (seen === 'duplicate') return { status: 200, body: { ok: true, duplicate: true } };

        if (cb.isFail || !cb.outputUrl) {
            const f = await failStep(cfg, step.id, cb.isFail ? (cb.errorCode || 'provider_error') : 'no_output', true);
            await deps.markProcessed(cfg, cb.source, cb.providerJobId);
            if (f && f.retry) await advance(step.job_id, cfg, env);
            return { status: 200, body: { ok: true } };
        }

        // Deterministic and never user-controlled: the step id and attempt.
        const key = `steps/${step.job_id}/${step.id}-${step.attempts}${cb.ext}`;
        const copy = await deps.copy(cb.outputUrl, key, { provider: cb.source, ...(cb.copyOptions || {}) });
        if (!copy.ok) {
            if (NON_RETRYABLE_COPY.test(String(copy.error || ''))) {
                await failStep(cfg, step.id, 'asset_store_failed', false);
                await deps.markProcessed(cfg, cb.source, cb.providerJobId);
                return { status: 200, body: { ok: true, warn: 'asset_store_failed' } };
            }
            return { status: 500, body: { error: 'asset_store_failed' } };
        }

        const stored = await deps.rpc('job_step_stored', {
            p_provider: cb.source, p_provider_job_id: cb.providerJobId, p_r2_key: copy.r2Key,
            p_mime: copy.mimeType, p_size: copy.size, p_sha256: copy.sha256, p_output_text: null,
        }, cfg);
        if (!stored || stored.ok !== true) {
            // Parent swept and refunded, or the step moved on: nothing to do.
            await deps.markProcessed(cfg, cb.source, cb.providerJobId);
            return { status: 200, body: { ok: true, warn: stored && stored.code } };
        }

        await advance(step.job_id, cfg, env);
        await deps.markProcessed(cfg, cb.source, cb.providerJobId);
        return { status: 200, body: { ok: true } };
    }

    /**
     * Sweep companion, from the five-minute cron. Frees stranded claims,
     * retries steps whose callback never came, and re-drives parents with
     * ready work.
     */
    async function redriveDue(cfg, env) {
        const due = await deps.rpc('job_steps_due', {}, cfg);
        if (!due || due.ok !== true) return { ok: false };
        const stale = Array.isArray(due.stale) ? due.stale : [];
        for (const s of stale) await failStep(cfg, s.step_id, 'step_timeout', true);
        const jobs = new Set([...(Array.isArray(due.redrive) ? due.redrive : []), ...stale.map((s) => s.job_id)]);
        for (const id of jobs) await advance(id, cfg, env);
        return { ok: true, released: due.released, retried: stale.length, redriven: jobs.size };
    }

    return { advance, onStepCallback, redriveDue };
}

export const engine = makeEngine();
