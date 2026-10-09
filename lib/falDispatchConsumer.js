import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { falDispatchRuntime, runFalDispatchAttempt } from './falDispatchAttempt.js';
import { FAL_JOB_ID, validFalWakeup } from './falDispatchMessage.js';

const validClaim = (claim, jobId) => claim?.job_id === jobId && typeof claim.attempt_token === 'string' && FAL_JOB_ID.test(claim.attempt_token)
    && typeof claim.endpoint === 'string' && /^[A-Za-z0-9/_.-]{3,128}$/.test(claim.endpoint)
    && claim.payload && typeof claim.payload === 'object' && !Array.isArray(claim.payload);

/** Retries only references. STARTED ownership is decided exclusively by Postgres. */
export async function runFalDispatchQueue(batch, env, { rpc = realRpc, submit, now = Date.now, measureNow = () => performance.now() } = {}) {
    const measuredStart = measureNow();
    const rpcTimings = Object.fromEntries(['recover_fal_dispatch', 'claim_fal_dispatch', 'record_fal_dispatch']
        .map(name => [name, { calls: 0, total_ms: 0, max_ms: 0 }]));
    const measuredRpc = async (name, args, cfg) => {
        const started = measureNow();
        try { return await rpc(name, args, cfg); }
        finally {
            const timing = rpcTimings[name];
            const elapsed = Math.max(0, Math.round(measureNow() - started));
            timing.calls++;
            timing.total_ms += elapsed;
            timing.max_ms = Math.max(timing.max_ms, elapsed);
        }
    };
    const deadline = now() + 180_000;
    const result = { ok: true, submitted: 0, failed: 0, retried: 0, ignored: 0 };
    const retry = message => { message.retry({ delaySeconds: 30 }); result.retried++; result.ok = false; };
    if (!env.FAL_DISPATCH_QUEUE_NAME || batch.queue !== env.FAL_DISPATCH_QUEUE_NAME) {
        for (const message of batch.messages) retry(message);
        console.error(JSON.stringify({ event: 'generation.dispatch_queue_mismatch' }));
        return result;
    }
    const runtime = falDispatchRuntime(env);
    let healthy = env.FAL_DISPATCH_SCHEMA_ENABLED === 'true' && env.FAL_DISPATCH_QUEUE_CONSUMER_ENABLED === 'true' && runtime.ok;
    let recovered = false, processed = 0;
    for (const message of batch.messages) {
        if (!validFalWakeup(message.body)) {
            message.ack(); result.ignored++;
            console.error(JSON.stringify({ event: 'generation.dispatch_queue_invalid' }));
            continue;
        }
        if (!healthy || processed++ >= 10 || now() >= deadline - 50_000) { retry(message); continue; }
        if (!recovered) {
            try { healthy = (await measuredRpc('recover_fal_dispatch', { p_limit: 10 }, runtime.cfg))?.ok === true; }
            catch { healthy = false; }
            recovered = true;
            if (!healthy) { retry(message); continue; }
        }
        if (now() >= deadline - 50_000) { retry(message); continue; }
        const jobId = message.body.job_id;
        let claim;
        try { claim = await measuredRpc('claim_fal_dispatch', { p_job_id: jobId }, runtime.cfg); }
        catch { retry(message); healthy = false; continue; }
        if (['MISSING', 'INELIGIBLE', 'EXPIRED'].includes(claim?.disposition)) {
            message.ack(); result.ignored++;
            continue;
        }
        if (claim?.disposition !== 'CLAIMED' || !validClaim(claim, jobId)) {
            retry(message);
            if (claim?.disposition !== 'BUSY') {
                healthy = false;
                console.error(JSON.stringify({ event: 'generation.dispatch_claim_invalid', job_id: jobId }));
            }
            continue;
        }
        result.submitted++;
        const attempted = await runFalDispatchAttempt(claim, runtime, { rpc: measuredRpc, ...(submit ? { submit } : {}) });
        // Even an evidence outage must not turn a billable attempt into a retry.
        message.ack();
        result.failed += attempted.failed;
        if (!attempted.ok) { healthy = false; result.ok = false; }
    }
    console.log(JSON.stringify({ event: 'generation.dispatch_queue_batch', ...result,
        elapsed_ms: Math.max(0, Math.round(measureNow() - measuredStart)), rpc_timings: rpcTimings }));
    return result;
}
