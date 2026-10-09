// ADR-0076: one attempt per durable fal job; only database evidence is retried.
import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { submitJob } from '../packages/adapters/fal.js';
import { shapePayload } from './modelCapabilities.js';
import { falDispatchRuntime, runFalDispatchAttempt } from './falDispatchAttempt.js';

export const falDispatchEnabled = (env) => env.FAL_DISPATCH_SCHEMA_ENABLED === 'true'
    && env.FAL_DURABLE_DISPATCH_ENABLED === 'true';

/** Route admission owns validation; RPC owns price, replay equality and atomic money effects. */
export async function admitFalDispatch({ userId, key, model, record, inputs, jobInputs, free, cfg, rpc = realRpc, onCommitted }) {
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
    // A wakeup failure cannot undo the committed admission or invite another debit.
    if (onCommitted) {
        try { await onCommitted(result.job_id); }
        catch { console.error(JSON.stringify({ event: 'generation.dispatch_wakeup_failed', job_id: result.job_id })); }
    }
    return Response.json({ job_id: result.job_id, state: result.state, balance_after: result.balance_after,
        ...(result.idempotent ? { idempotent: true } : {}), ...(result.free ? { free_allowance: true } : {}),
    }, { status: result.idempotent ? 200 : 202, headers: { 'cache-control': 'no-store' } });
}

/** Bounded cron bridge. Disabling admission must leave recovery running. */
export async function runFalDispatch(env, { rpc = realRpc, submit = submitJob, now = Date.now } = {}) {
    if (env.FAL_DISPATCH_SCHEMA_ENABLED !== 'true') return { ok: true, disabled: true };
    const runtime = falDispatchRuntime(env);
    if (!runtime.ok) return runtime;
    const { cfg } = runtime;
    const deadline = now() + 180_000;
    const first = await rpc('recover_fal_dispatch', { p_limit: 10 }, cfg);
    if (first?.ok !== true) return { ok: false, failed: 1 };
    let submitted = 0, failed = 0;
    while (submitted < 10 && now() < deadline - 50_000) {
        // Lost claim acknowledgement is safe: STARTED will not be claimed again.
        const job = await rpc('start_fal_dispatch', {}, cfg);
        if (!job) break;
        submitted++;
        const result = await runFalDispatchAttempt(job, runtime, { rpc, submit });
        failed += result.failed;
        if (!result.recorded || !result.recoveryOk) break;
    }
    return { ok: failed === 0, submitted, failed };
}
