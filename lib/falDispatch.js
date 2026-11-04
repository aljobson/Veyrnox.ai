// ADR-0076: one attempt per durable fal job; only database evidence is retried.
import { rpc as realRpc, SupabaseError } from '../packages/db/supabase-client.js';
import { submitJob } from '../packages/adapters/fal.js';
import { shapePayload } from './modelCapabilities.js';
import { falDispatchRuntime, runFalDispatchAttempt } from './falDispatchAttempt.js';
import { providerSpendBody, providerSpendError, providerSpendLimit } from './providerSpend.js';

export const falDispatchEnabled = (env) => env.FAL_DISPATCH_SCHEMA_ENABLED === 'true'
    && env.FAL_DURABLE_DISPATCH_ENABLED === 'true';

function missingCappedAdmission(error) {
    if (!(error instanceof SupabaseError)) return false;
    const body = error.body;
    const message = typeof body === 'object' && body !== null
        ? `${body.message || ''} ${body.details || ''}` : String(body || '');
    return /\badmit_fal_dispatch_capped\b/.test(message)
        && (body?.code === 'PGRST202'
            || (error.status === 404 && /schema cache/i.test(message)));
}

const acceptanceUnknown = () => Response.json({ error: 'dispatch_acceptance_unknown' }, { status: 503 });

/** Route admission owns validation; RPC owns price, replay equality and atomic money effects. */
export async function admitFalDispatch({ userId, key, model, record, inputs, jobInputs, free, maxCharge, existingJob, cfg, rpc = realRpc, onCommitted }) {
    const capped = maxCharge !== undefined;
    let result, args;
    try {
        args = {
            p_user_id: userId, p_idempotency_key: key, p_model_id: model.id,
            p_inputs: jobInputs, p_payload: shapePayload(record, inputs, {}),
            p_endpoint: model.provider_endpoint, p_allow_free: free,
        };
        // SQL prices and debit amounts are INTEGER; retain the original client
        // ceiling for responses while avoiding PostgREST integer overflow.
        result = await rpc(capped ? 'admit_fal_dispatch_capped' : 'admit_fal_dispatch', {
            ...args, ...(capped ? { p_max_charge: Math.min(maxCharge, 2147483647) } : {}),
        }, cfg);
    } catch (error) {
        const spend = providerSpendError(error);
        if (spend) return Response.json(providerSpendBody(spend), {
            status: spend.status, headers: { 'retry-after': String(spend.retryAfter) },
        });
        if (capped && missingCappedAdmission(error)) {
            // Only proven non-execution permits the PR A compatibility path.
            // An owned existing job is immutable and the legacy RPC verifies
            // payload identity before returning it without another debit.
            try {
                if (existingJob && await existingJob() === true) {
                    result = await rpc('admit_fal_dispatch', args, cfg);
                } else {
                    return Response.json({ error: 'admission_unavailable' }, { status: 503 });
                }
            } catch (replayError) {
                const replaySpend = providerSpendError(replayError);
                if (replaySpend) return Response.json(providerSpendBody(replaySpend), {
                    status: replaySpend.status, headers: { 'retry-after': String(replaySpend.retryAfter) },
                });
                return acceptanceUnknown();
            }
        } else {
            // A lost acknowledgement may conceal a committed job. Never fall back
            // to ledger_debit or submit; the client can replay this exact key.
            return acceptanceUnknown();
        }
    }
    if (capped) {
        const spend = providerSpendLimit(result);
        if (spend) return Response.json(providerSpendBody(spend), {
            status: spend.status, headers: { 'retry-after': String(spend.retryAfter) },
        });
        const refusal = result?.ok === false && typeof result.code === 'string' && result.code.length > 0;
        const accepted = result?.ok === true && typeof result.job_id === 'string' && result.job_id.length > 0
            && typeof result.state === 'string' && result.state.length > 0 && Number.isFinite(result.balance_after)
            && (result.idempotent === undefined || typeof result.idempotent === 'boolean')
            && (result.free === undefined || typeof result.free === 'boolean');
        if (!refusal && !accepted) return acceptanceUnknown();
        if (refusal && result.code === 'PRICE_EXCEEDS_CEILING') {
            if (!Number.isInteger(result.expected_credits) || result.expected_credits < 0) return acceptanceUnknown();
            return Response.json({ error: 'price_changed', expected_credits: result.expected_credits,
                max_charge_credits: maxCharge }, { status: 409 });
        }
    }
    if (!result || result.ok !== true) {
        const code = result?.code;
        const spend = providerSpendLimit(result);
        if (spend) return Response.json(providerSpendBody(spend), {
            status: spend.status, headers: { 'retry-after': String(spend.retryAfter) },
        });
        const status = code === 'PROVIDER_ADMISSION_PAUSED' || code === 'PROVIDER_CAPACITY_UNAVAILABLE' ? 503
            : code === 'IDEMPOTENCY_CONFLICT' ? 409 : code === 'RATE_LIMITED' ? 429
            : code === 'INSUFFICIENT_BALANCE' ? 402 : code === 'ACCOUNT_FROZEN' || code === 'ACCOUNT_ON_HOLD' ? 403 : 400;
        const retry = Math.max(1, Math.min(600, Number(result?.retry_after_seconds) || 60));
        return Response.json({ error: code ? String(code).toLowerCase() : 'dispatch_rejected' }, {
            status, headers: status === 429 || status === 503 ? { 'retry-after': String(retry) } : {},
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
