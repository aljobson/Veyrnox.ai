// ADR-0076: one attempt per durable fal job; only database evidence is retried.
import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { submitJob } from '../packages/adapters/fal.js';
import { shapePayload } from './modelCapabilities.js';

export const falDispatchEnabled = (env) => env.FAL_DISPATCH_SCHEMA_ENABLED === 'true'
    && env.FAL_DURABLE_DISPATCH_ENABLED === 'true';

/** Route admission owns validation; RPC owns price, replay equality and atomic money effects. */
export async function admitFalDispatch({ userId, key, model, record, inputs, jobInputs, free, cfg, rpc = realRpc }) {
    let result;
    try {
        result = await rpc('admit_fal_dispatch', {
            p_user_id: userId, p_idempotency_key: key, p_model_id: model.id,
            p_inputs: jobInputs, p_payload: shapePayload(record, inputs, {}),
            p_endpoint: model.provider_endpoint, p_allow_free: free,
        }, cfg);
    } catch {
        // A lost acknowledgement may conceal a committed job. Never fall back
        // to ledger_debit or submit; the client can replay this exact key.
        return Response.json({ error: 'dispatch_acceptance_unknown' }, { status: 503 });
    }
    if (!result || result.ok !== true) {
        const code = result?.code;
        const status = code === 'IDEMPOTENCY_CONFLICT' ? 409 : code === 'RATE_LIMITED' ? 429
            : code === 'INSUFFICIENT_BALANCE' ? 402 : code === 'ACCOUNT_FROZEN' ? 403 : 400;
        const retry = Math.max(1, Math.min(600, Number(result?.retry_after_seconds) || 60));
        return Response.json({ error: code ? String(code).toLowerCase() : 'dispatch_rejected' }, {
            status, headers: status === 429 ? { 'retry-after': String(retry) } : {},
        });
    }
    return Response.json({ job_id: result.job_id, state: result.state, balance_after: result.balance_after,
        ...(result.idempotent ? { idempotent: true } : {}), ...(result.free ? { free_allowance: true } : {}),
    }, { status: result.idempotent ? 200 : 202, headers: { 'cache-control': 'no-store' } });
}

/** Bounded cron bridge. Disabling admission must leave recovery running. */
export async function runFalDispatch(env, { rpc = realRpc, submit = submitJob, now = Date.now } = {}) {
    if (env.FAL_DISPATCH_SCHEMA_ENABLED !== 'true') return { ok: true, disabled: true };
    const cfg = { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !env.FAL_KEY || !env.PUBLIC_HOST) {
        return { ok: false, skipped: 'not_configured' };
    }
    let webhook;
    try {
        webhook = new URL('/api/webhook/fal', env.PUBLIC_HOST);
        if (webhook.protocol !== 'https:') throw new Error('invalid host');
    } catch { return { ok: false, skipped: 'invalid_host' }; }
    const deadline = now() + 180_000;
    const first = await rpc('recover_fal_dispatch', { p_limit: 10 }, cfg);
    if (first?.ok !== true) return { ok: false, failed: 1 };
    let submitted = 0, failed = 0;
    while (submitted < 10 && now() < deadline - 50_000) {
        // Lost claim acknowledgement is safe: STARTED will not be claimed again.
        const job = await rpc('start_fal_dispatch', {}, cfg);
        if (!job) break;
        submitted++;
        let answer;
        try {
            answer = await submit({ job_id: job.job_id, provider_endpoint: job.endpoint, inputs: job.payload }, {
                falKey: env.FAL_KEY, webhookBaseUrl: webhook.toString(), timeoutMs: 15_000,
            });
        } catch { answer = { outcome: 'unknown' }; }
        const outcome = answer?.outcome === 'accepted' ? 'ACCEPTED'
            : answer?.outcome === 'rejected' ? 'REJECTED' : 'UNKNOWN';
        let recorded = false;
        // Retrying identical evidence writes is safe, including a lost ACK.
        for (let attempt = 0; attempt < 2 && !recorded; attempt++) {
            try {
                const result = await rpc('record_fal_dispatch', {
                    p_job_id: job.job_id, p_attempt_token: job.attempt_token, p_outcome: outcome,
                    p_provider_job_id: outcome === 'ACCEPTED' ? answer.providerJobId : null,
                }, cfg);
                recorded = result?.ok === true;
            } catch { /* The next write replays this same evidence, never the submit. */ }
        }
        if (!recorded || outcome === 'UNKNOWN') {
            failed++;
            console.error(JSON.stringify({ event: 'generation.durable_dispatch_unknown', job_id: job.job_id,
                attempt_token: job.attempt_token, outcome,
                ...(outcome === 'ACCEPTED' ? { provider_job_id: answer.providerJobId } : {}) }));
        }
        const recovered = await rpc('recover_fal_dispatch', { p_limit: 10 }, cfg);
        if (recovered?.ok !== true) { failed++; break; }
        // Stop on evidence outage; do not spend more while persistence is failing.
        if (!recorded) break;
    }
    return { ok: failed === 0, submitted, failed };
}
