import { NextResponse } from 'next/server';
import { providerFor } from '../packages/provider-sdk/registry.js';
import { capabilityFor } from './modelCapabilities.js';
import { recordFirstAttempt } from './supplierRoutesDispatch.js';
import { submitWithFailover } from './supplierRoutesFailover.js';
import { refundRejectedSubmit, unknownSubmitResponse, recordSubmittedJob } from './submitRejection.js';
import { classifySubmitFailure } from './submitFailureClass.js';

export async function finishGenerationSubmit({ jobId, userId, credits, modelRow, ownRoute, offerRoutes, rawKeys, rawAssets, record, modelInputs, storedInputs, publicHost, sources, provider, providerKey, balanceAfter, debit }, cfg) {
    // These paid providers are always guarded: an ambiguous response may
    // already have spent supplier credits, so it must never trigger an
    // automatic refund. fal's durable outbox normally owns this boundary;
    // this also protects the legacy path while rollout flags change.
    // 4. Submit to the provider. With SUPPLIER_ROUTES_ENABLED and a second proven route, a supplier's
    //    provable refusal (auth, payment, capacity) may be routed to the next route (ADR-0256 phase 2);
    //    an ambiguous answer never is. Otherwise this is one submit, exactly as before.
    const submitted = await submitWithFailover({
        jobId, modelRow, ownRoute, routes: offerRoutes,
        canHop: !rawKeys.length && !rawAssets.length && !record.edit,
        inputs: modelInputs, jobInputs: record.edit ? storedInputs : modelInputs, publicHost, sources,
        first: { provider, record, key: providerKey },
        deps: { providerFor, capabilityFor },
    }, cfg);
    const submitResult = submitted.result;
    // The supplier that actually holds the job: route 1 unless a failover moved it.
    const servedBy = submitted.supplier;
    const guardedSubmit = ['fal', 'kie', 'grsai', 'openrouter', 'crun', 'higgsfield'].includes(servedBy);

    if (!submitResult.ok) {
        if (guardedSubmit && submitResult.outcome === 'unknown') return unknownSubmitResponse(jobId, cfg);
        // Record why on the job, then refund — the provider wouldn't take the
        // job so we owe the credits back. An untyped refusal (fal and kie
        // return log strings) may be classified by Jev (ADR-0066); null keeps
        // the generic code, and the refund is the same either way.
        const errorCode = submitResult.errorCode || await classifySubmitFailure(submitResult.error, process.env);
        await refundRejectedSubmit({ jobId, userId, credits, errorCode }, cfg);
        console.error('[generations] provider submit failed:', servedBy, submitResult.error);
        // A topic the script writer refused is the user's to change, not an outage.
        if (submitResult.errorCode === 'script_refused') return NextResponse.json({ error: 'topic_refused' }, { status: 422 });
        // So is a prompt the provider refused, or an input it would not take.
        if (errorCode === 'provider_moderation' || errorCode === 'provider_input_rejected') {
            return NextResponse.json({ error: errorCode }, { status: 422 });
        }
        // Don't leak upstream vendor payloads to the client — log only.
        return NextResponse.json({ error: 'provider_submit_failed' }, { status: 502 });
    }

    // 5. Move state to SUBMITTED and record provider job id.
    const recorded = await recordSubmittedJob({ jobId, provider: servedBy, providerJobId: submitResult.providerJobId }, cfg);
    if (guardedSubmit && !recorded) return unknownSubmitResponse(jobId, cfg);
    if (recorded) await recordFirstAttempt({ jobId, route: submitted.route, attemptNo: submitted.attemptNo, providerJobId: submitResult.providerJobId }, cfg);

    return NextResponse.json({
        job_id: jobId,
        state: 'SUBMITTED',
        balance_after: balanceAfter,
        ...(debit.free ? { free_allowance: true } : {}),
    });
}
