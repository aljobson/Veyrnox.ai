import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { submitJob } from '../packages/adapters/fal.js';

export function falDispatchRuntime(env) {
    const cfg = { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !env.FAL_KEY || !env.PUBLIC_HOST) {
        return { ok: false, skipped: 'not_configured' };
    }
    try {
        const webhook = new URL('/api/webhook/fal', env.PUBLIC_HOST);
        if (webhook.protocol !== 'https:') throw new Error('invalid host');
        return { ok: true, cfg, falKey: env.FAL_KEY, webhookBaseUrl: webhook.toString() };
    } catch { return { ok: false, skipped: 'invalid_host' }; }
}

/** Called only after a confirmed, fenced STARTED claim. Never retries fal. */
export async function runFalDispatchAttempt(job, runtime, { rpc = realRpc, submit = submitJob } = {}) {
    let answer;
    try {
        answer = await submit({ job_id: job.job_id, provider_endpoint: job.endpoint, inputs: job.payload }, {
            falKey: runtime.falKey, webhookBaseUrl: runtime.webhookBaseUrl, timeoutMs: 15_000,
        });
    } catch { answer = { outcome: 'unknown' }; }
    const outcome = answer?.outcome === 'accepted' ? 'ACCEPTED'
        : answer?.outcome === 'rejected' ? 'REJECTED' : 'UNKNOWN';
    let recorded = false;
    for (let attempt = 0; attempt < 2 && !recorded; attempt++) {
        try {
            const result = await rpc('record_fal_dispatch', {
                p_job_id: job.job_id, p_attempt_token: job.attempt_token, p_outcome: outcome,
                p_provider_job_id: outcome === 'ACCEPTED' ? answer.providerJobId : null,
            }, runtime.cfg);
            recorded = result?.ok === true;
        } catch { /* Retry identical evidence, never the provider call. */ }
    }
    let failed = !recorded || outcome === 'UNKNOWN' ? 1 : 0;
    if (failed) {
        console.error(JSON.stringify({ event: 'generation.durable_dispatch_unknown', job_id: job.job_id,
            attempt_token: job.attempt_token, outcome,
            ...(outcome === 'ACCEPTED' ? { provider_job_id: answer.providerJobId } : {}) }));
    }
    let recoveryOk = false;
    try { recoveryOk = (await rpc('recover_fal_dispatch', { p_limit: 10 }, runtime.cfg))?.ok === true; }
    catch { /* Accepted evidence remains available for the cron backstop. */ }
    if (!recoveryOk) {
        failed++;
        console.error(JSON.stringify({ event: 'generation.dispatch_recovery_failed', job_id: job.job_id }));
    }
    return { ok: failed === 0, failed, recorded, recoveryOk };
}
