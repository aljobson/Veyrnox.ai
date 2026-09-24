/** Authenticated GrsAI polling from the existing five-minute Worker cron.
 * Results expire after two hours; completeJob copies them into R2 and uses
 * the existing idempotent success/refund RPCs. A transient read/copy failure
 * is retried next tick, never by submitting another paid generation.
 */
import { select } from '../packages/db/supabase-client.js';
import { fetchTask, ENDPOINT } from '../packages/adapters/grsai.js';
import { completeJob, extFromUrl } from './providerCompletion.js';
import { isConfigured } from '../packages/adapters/r2.js';

export const BATCH = 50;
export const TIMEOUT_MINUTES = 30;

export async function sweepGrsai({ cfg, r2cfg, apiKey, now = new Date(), read = fetchTask, complete = completeJob }) {
    if (!apiKey || !cfg?.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2cfg)) {
        return { skipped: 'not_configured' };
    }
    // jobs.model_id is not a foreign key, so PostgREST cannot embed catalog.
    // Check the staged row explicitly instead of assuming a relationship.
    const modelId = 'nano-banana-pro-grsai';
    const models = await select('model_catalog', {
        columns: 'id',
        filter: `id=eq.${modelId}&provider=eq.grsai&provider_endpoint=eq.${encodeURIComponent(ENDPOINT)}&limit=1`,
    }, cfg);
    if (!Array.isArray(models) || models[0]?.id !== modelId) return { skipped: 'catalog_not_configured' };
    const rows = await select('jobs', {
        columns: 'id,user_id,credits,state,provider_job_id,created_at',
        filter: `provider=eq.grsai&provider_job_id=not.is.null&state=in.(SUBMITTED,SUCCEEDED,FAILED)&model_id=eq.${modelId}&order=created_at.asc&limit=${BATCH}`,
    }, cfg);
    const out = { checked: 0, applied: 0, pending: 0, errors: 0 };
    // Five concurrent reads bound latency while preserving headroom for the
    // other cron tasks. Oldest jobs first; the database sweep is a backstop.
    const jobs = Array.isArray(rows) ? rows.slice(0, BATCH) : [];
    for (let start = 0; start < jobs.length; start += 5) {
        await Promise.all(jobs.slice(start, start + 5).map(async (job) => {
            out.checked += 1;
            try {
                let outcome;
                // A previous failure whose refund failed must stay a failure,
                // even if a later provider response changes or is unavailable.
                if (job.state === 'FAILED') outcome = { state: 'fail', errorCode: 'provider_error' };
                else {
                    const result = await read(job.provider_job_id, { apiKey });
                    if (!result.ok) { out.errors += 1; return; }
                    outcome = result;
                    const age = (now.getTime() - new Date(job.created_at).getTime()) / 60_000;
                    if (outcome.state === 'pending' && job.state === 'SUBMITTED' && age > TIMEOUT_MINUTES) {
                        outcome = { state: 'fail', errorCode: 'provider_timeout' };
                    }
                }
                if (outcome.state === 'pending') { out.pending += 1; return; }
                const r = await complete({ source: 'grsai', job, providerJobId: job.provider_job_id,
                    outcome, ext: extFromUrl(outcome.outputUrl, '.png'), cfg, r2cfg });
                if (r.status === 200 && !r.body?.warn) out.applied += 1; else out.errors += 1;
            } catch {
                out.errors += 1;
                console.error('[grsai-sweep] job completion failed');
            }
        }));
    }
    return out;
}
