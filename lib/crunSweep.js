/** Authenticated Crun polling from the five-minute Worker cron (ADR-0256 phase 5). Crun documents no
 * signed callback and none is registered, so this sweep is the only completion path. Outputs are kept
 * 14 days at a third-party temp host; completeJob copies them into R2 and uses the existing idempotent
 * success and refund RPCs. A transient read or copy failure is retried next tick, never by submitting
 * another paid generation. Off unless CRUN_ENABLED is "true" (worker.js).
 */
import { sweepRows } from './sweepRows.js';
import { catalogSelect } from './catalogReadCache.js';
import { fetchTask, parseEndpoint, endpointKind } from '../packages/adapters/crun.js';
import { completeJob, extFromUrl } from './providerCompletion.js';
import { isConfigured } from '../packages/adapters/r2.js';
import { isPrivateModelId } from './privateModelIds.js';
import { paceCrunTaskInfo } from './crunPollPacer.js';

export const BATCH = 50;
// The first probe took 56 s. Allow far longer before refunding; the database sweep remains the backstop.
export const TIMEOUT_MINUTES = 45;

export async function sweepCrun({ cfg, r2cfg, apiKey, now = new Date(), read = fetchTask, complete = completeJob, onlyJobId = null, pace = paceCrunTaskInfo }) {
    // Check-on-read (lib/refreshPolledJob.js): settle one job now instead of waiting for the minute tick.
    const only = typeof onlyJobId === 'string' && /^[0-9a-f-]{36}$/i.test(onlyJobId) ? `&id=eq.${onlyJobId}` : '';
    if (!apiKey || !cfg?.supabaseUrl || !cfg.serviceRoleKey || !isConfigured(r2cfg)) return { skipped: 'not_configured' };
    // A job's provider is the supplier that holds it, which after a failover differs from the catalog row's
    // provider. The models Crun may hold are therefore read from the routes, and only routes whose endpoint
    // this adapter owns count.
    const routes = await catalogSelect(only, 'model_routes', { columns: 'model_id,endpoint', filter: 'supplier=eq.crun&limit=50' }, cfg);
    const ids = [...new Set((Array.isArray(routes) ? routes : [])
        // Audio (Suno) routes are settled by the music path (phase B): this video/image sweep must never complete
        // or time out an audio task as an MP4, so audio-kind routes are excluded here.
        .filter((r) => typeof r.model_id === 'string' && /^[a-z0-9.-]{1,64}$/.test(r.model_id) && parseEndpoint(r.endpoint)
            && endpointKind(r.endpoint) !== 'audio')
        .map((r) => r.model_id))];
    if (!ids.length) return { skipped: 'no_routes' };
    // An image offer's output is a picture, not an MP4: the file type and copy rules follow the route's endpoint.
    const kinds = new Map();
    for (const r of Array.isArray(routes) ? routes : []) if (parseEndpoint(r.endpoint)) kinds.set(r.model_id, endpointKind(r.endpoint));
    const rows = await sweepRows({ columns: 'id,user_id,credits,state,provider_job_id,created_at,model_id',
        filter: `provider=eq.crun&provider_job_id=not.is.null&state=in.(SUBMITTED,SUCCEEDED,FAILED)&model_id=in.(${ids.join(',')})${only}`, only, now, cfg, batch: BATCH });
    const out = { checked: 0, applied: 0, pending: 0, errors: 0 };
    const jobs = Array.isArray(rows) ? rows.slice(0, BATCH) : [];
    const deadline = performance.now() + 180_000;
    for (let start = 0; start < jobs.length && performance.now() < deadline; start += 5) {
        const batch = jobs.slice(start, start + 5);
        const reads = await Promise.allSettled(batch.map(async (job) => {
            if (job.state === 'FAILED') return { ok: true, state: 'fail', errorCode: 'provider_error' };
            const paced = await pace({ cfg, purpose: 'generic.taskinfo' });
            if (paced === false) return { ok: false, pacedOut: true };
            return read(job.provider_job_id, { apiKey });
        }));
        // One copy at a time: concurrent buffered R2 copies can exceed the Worker's memory limit.
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
                // A swap job's request carried signed media: only a plain code from Crun is kept (ADR-0351 amendment 21).
                if (outcome.state === 'fail' && isPrivateModelId(job.model_id) && !/^[A-Za-z0-9_.-]{1,40}$/.test(String(outcome.errorCode))) {
                    outcome = { ...outcome, errorCode: 'provider_failed' };
                }
                const isImage = kinds.get(job.model_id) === 'image';
                const r = await complete({ source: 'crun', job, providerJobId: job.provider_job_id,
                    outcome, ext: isImage ? extFromUrl(outcome.outputUrl, '.png') : '.mp4', cfg, r2cfg,
                    copyOptions: isImage ? { maxBytes: 20 * 1024 * 1024 } : { maxBytes: 60 * 1024 * 1024, expectMp4: true } });
                if (r.status === 200 && !r.body?.warn) out.applied += 1; else out.errors += 1;
            } catch {
                out.errors += 1;
                console.error('[crun-sweep] job completion failed');
            }
        }
    }
    return out;
}
