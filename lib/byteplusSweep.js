/** Authenticated BytePlus ModelArk polling from the five-minute Worker cron
 * (ADR-0058). ModelArk's callback is unsigned and is not registered, so this
 * sweep is the only completion path. Output URLs expire after 24 hours;
 * completeJob copies them into R2 and uses the existing idempotent
 * success/refund RPCs. A transient read/copy failure is retried next tick,
 * never by submitting another paid generation.
 */
import { select } from '../packages/db/supabase-client.js';
import { fetchTask, isEndpoint } from '../packages/adapters/byteplus.js';
import { completeJob } from './providerCompletion.js';
import { isConfigured } from '../packages/adapters/r2.js';

export const BATCH = 50;
// A 5s clip normally resolves in one to three minutes; ModelArk queues under
// load, so allow longer before refunding than the two-hour GrsAI image path
// would ever need. The database sweep remains the backstop.
export const TIMEOUT_MINUTES = 45;

export async function sweepByteplus({ cfg, r2cfg, apiKey, now = new Date(), read = fetchTask, complete = completeJob }) {
    if (!apiKey || !cfg?.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2cfg)) {
        return { skipped: 'not_configured' };
    }
    // jobs.model_id is not a foreign key, so PostgREST cannot embed catalog.
    // Only rows whose endpoint this adapter owns are swept; a byteplus row
    // pointing at an unknown endpoint is never completed from here.
    const models = await select('model_catalog', {
        columns: 'id,provider_endpoint',
        filter: 'provider=eq.byteplus&order=id.asc&limit=50',
    }, cfg);
    const ids = (Array.isArray(models) ? models : [])
        .filter((m) => typeof m.id === 'string' && /^[a-z0-9.-]{1,64}$/.test(m.id) && isEndpoint(m.provider_endpoint))
        .map((m) => m.id);
    if (!ids.length) return { skipped: 'catalog_not_configured' };
    const rows = await select('jobs', {
        columns: 'id,user_id,credits,state,provider_job_id,created_at',
        filter: `provider=eq.byteplus&provider_job_id=not.is.null&state=in.(SUBMITTED,SUCCEEDED,FAILED)&model_id=in.(${ids.join(',')})&order=created_at.asc&limit=${BATCH}`,
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
        // Copy one clip at a time: concurrent buffered R2 copies can exceed
        // the Worker's memory limit even when each clip meets the size cap.
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
                // Every priced unit is an MP4; the copier decides the type from
                // the bytes and refuses anything else (a 5s 720p clip is a few MB).
                const r = await complete({ source: 'byteplus', job, providerJobId: job.provider_job_id,
                    outcome, ext: '.mp4', cfg, r2cfg,
                    copyOptions: { maxBytes: 60 * 1024 * 1024, expectMp4: true } });
                if (r.status === 200 && !r.body?.warn) out.applied += 1; else out.errors += 1;
            } catch {
                out.errors += 1;
                console.error('[byteplus-sweep] job completion failed');
            }
        }
    }
    return out;
}
