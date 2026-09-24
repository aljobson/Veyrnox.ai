/**
 * Auto Short step sweep — slice 3c of docs/auto-short/SPEC.md (ADR-0029 §4).
 *
 * Runs with the five-minute cron (worker.js). A step still SUBMITTED after
 * STALE_MINUTES is re-read from its provider with our key, exactly as a
 * callback would be: a finished result is applied, a failure is retried or
 * refunded by the orchestrator, and a step still pending after
 * TIMEOUT_MINUTES counts as failed. The outcome goes through the same
 * webhook_events dedup as a callback, so a late callback for the same id is
 * a no-op. sweep_stuck_jobs (0018) stays the backstop for the parent at 120 min.
 */

import { select } from '../packages/db/supabase-client.js';
import * as kie from '../packages/adapters/kie.js';
import { handleStepCallback, falOutcome } from './autoShortWebhook.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

// kie's slow tail reached 552s for one scene in slice 0.
export const STALE_MINUTES = 12;
export const TIMEOUT_MINUTES = 30;
const BATCH = 20;
const FAL_QUEUE = 'https://queue.fal.run';
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** fal's queue addresses requests by app ("owner/app"), not by the full endpoint path. */
export function falAppId(endpoint) {
    const parts = String(endpoint || '').split('/');
    return parts.length >= 2 && /^[A-Za-z0-9._-]+$/.test(parts[0]) && /^[A-Za-z0-9._-]+$/.test(parts[1])
        ? `${parts[0]}/${parts[1]}` : null;
}

/** Re-read one fal request. Returns an outcome in the webhook's shape. */
export async function pollFal(step, falKey, fetchImpl = fetchWithTimeout) {
    const app = falAppId(step.provider_endpoint);
    if (!app || !ID_RE.test(String(step.provider_job_id || ''))) return { state: 'fail', errorCode: 'provider_failed' };
    const base = `${FAL_QUEUE}/${app}/requests/${step.provider_job_id}`;
    const auth = { headers: { Authorization: `Key ${falKey}` } };
    const status = await fetchImpl(`${base}/status`, auth);
    if (!status.ok) return { state: 'pending' };
    const s = await status.json().catch(() => ({}));
    if (s.status !== 'COMPLETED') return { state: 'pending' };
    const res = await fetchImpl(base, auth);
    // A completed request whose result errors is a provider failure.
    if (!res.ok) return res.status >= 500 ? { state: 'pending' } : { state: 'fail', errorCode: 'provider_failed' };
    const payload = await res.json().catch(() => null);
    return falOutcome(step, { status: 'OK', payload: payload || {} });
}

/** Re-read one kie task. */
export async function pollKie(step, kieKey) {
    const rec = await kie.fetchTask(step.provider_endpoint, step.provider_job_id, { apiKey: kieKey });
    if (!rec.ok) return { state: 'pending' };
    if (rec.state === 'success') return { state: 'success', outputUrl: rec.outputUrl };
    if (rec.state === 'fail') return { state: 'fail', errorCode: 'provider_failed' };
    return { state: 'pending' };
}

/**
 * @param {{cfg:object, deps:object, falKey:string, kieKey:string, now?:Date, poll?:object}} args
 *   `poll` overrides the provider reads (tests).
 */
export async function sweepSteps({ cfg, deps, falKey, kieKey, now = new Date(), poll = {} }) {
    const staleBefore = new Date(now.getTime() - STALE_MINUTES * 60_000).toISOString();
    const rows = await select('job_steps', {
        // Only steps whose parent is still running: a step orphaned under a
        // failed or finished parent would otherwise hold its batch slot forever.
        columns: 'job_id,step,ordinal,provider,provider_endpoint,provider_job_id,state,attempts,output_r2_key,output_text,updated_at,jobs!inner(state)',
        // provider_job_id is null between job_step_claim and the submit that
        // attaches the id (0101). Re-reading such a row from the provider is
        // meaningless; it is stale only once it has an id to read.
        filter: `state=eq.SUBMITTED&provider_job_id=not.is.null&jobs.state=eq.SUBMITTED&updated_at=lt.${encodeURIComponent(staleBefore)}&order=updated_at.asc&limit=${BATCH}`,
    }, cfg);
    const readFal = poll.fal || ((step) => pollFal(step, falKey));
    const readKie = poll.kie || ((step) => pollKie(step, kieKey));
    const out = { checked: 0, applied: 0, timedOut: 0, errors: 0 };
    for (const step of Array.isArray(rows) ? rows : []) {
        out.checked += 1;
        try {
            let outcome = step.provider === 'fal' ? await readFal(step)
                : step.provider === 'kie' ? await readKie(step) : { state: 'fail', errorCode: 'provider_failed' };
            const ageMin = (now.getTime() - new Date(step.updated_at).getTime()) / 60_000;
            if (outcome.state === 'pending' && ageMin > TIMEOUT_MINUTES) {
                outcome = { state: 'fail', errorCode: 'step_timeout' };
                out.timedOut += 1;
            }
            if (outcome.state === 'pending') continue;
            const r = await handleStepCallback({ source: step.provider, providerJobId: step.provider_job_id, step, outcome, deps, cfg });
            if (r.status === 200) out.applied += 1; else out.errors += 1;
        } catch (err) {
            out.errors += 1;
            console.error('[auto-short-sweep] step failed:', step.step, err && err.message);
        }
    }
    return out;
}
