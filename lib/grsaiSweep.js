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
    // Five concurrent reads, serial storage and a three-minute work budget
    // preserve cron headroom. The database sweep is the timeout backstop.
    const jobs = Array.isArray(rows) ? rows.slice(0, BATCH) : [];
    const deadline = performance.now() + 180_000;
    for (let start = 0; start < jobs.length && performance.now() < deadline; start += 5) {
        const batch = jobs.slice(start, start + 5);
        const reads = await Promise.allSettled(batch.map((job) => job.state === 'FAILED'
            ? { ok: true, state: 'fail', errorCode: 'provider_error' }
            : read(job.provider_job_id, { apiKey })));
        // Copy one image at a time: concurrent buffered R2 copies can exceed
        // the Worker's memory limit even when each image meets the size cap.
        for (let i = 0; i < batch.length && performance.now() < deadline; i += 1) {
            const job = batch[i];
            out.checked += 1;
            try {
                const result = reads[i];
                if (result.status === 'rejected' || !result.value.ok) { out.errors += 1; continue; }
                let outcome = result.value;
                const age = (now.getTime() - new Date(job.created_at).getTime()) / 60_000;
                if (outcome.state === 'pending' && job.state === 'SUBMITTED' && age > TIMEOUT_MINUTES) {
                    outcome = { state: 'fail', errorCode: 'provider_timeout' };
                }
                if (outcome.state === 'pending') { out.pending += 1; continue; }
                const r = await complete({ source: 'grsai', job, providerJobId: job.provider_job_id,
                    outcome, ext: extFromUrl(outcome.outputUrl, '.png'), cfg, r2cfg,
                    copyOptions: { maxBytes: 20 * 1024 * 1024 } });
                if (r.status === 200 && !r.body?.warn) out.applied += 1; else out.errors += 1;
            } catch {
                out.errors += 1;
                console.error('[grsai-sweep] job completion failed');
            }
        }
    }
    return out;
}
