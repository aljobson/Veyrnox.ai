/**
 * Provider callbacks for Auto Short steps (ADR-0029 §4).
 *
 * The fal and kie routes verify the signature first, exactly as for a normal
 * job. When no `jobs` row carries the provider id, they look for a
 * `job_steps` row (lib/autoShortRuntime.findStep) and hand it here. The step
 * row (job, step, ordinal, owner via its parent) comes from our lookup, never
 * from the payload. Dedup and "processed" marking reuse webhook_events, so a
 * redelivery of a finished callback is a no-op and a 500 stays replayable.
 */

import { onStepOutcome } from './autoShort.js';
import { dedup, markProcessed } from './providerCompletion.js';

// Copy failures a redelivery cannot fix: the step fails instead of looping.
const NON_RETRYABLE_COPY = /^(source url invalid|source host not allowed|source too large|source not mp4|source [34]\d\d)$/;

/**
 * Outcome of a verified fal callback for one step.
 * Voice: payload.audio.url + payload.timestamps (ElevenLabs).
 * Stitch: payload.video_url (fal compose, slice 0).
 * @returns {{state:'success', outputUrl:string, timestamps?:any[]}|{state:'fail', errorCode:string}|{state:'pending'}}
 */
export function falOutcome(step, event) {
    const status = event && event.status;
    const isFail = status === 'failed' || status === 'ERROR' || Boolean(event && event.error);
    if (isFail) return { state: 'fail', errorCode: 'provider_failed' };
    if (!(status === 'completed' || status === 'OK' || status === 'SUCCESS')) return { state: 'pending' };
    const p = (event && event.payload) || {};
    if (step.step === 'voice') {
        const url = p.audio && p.audio.url;
        return typeof url === 'string' ? { state: 'success', outputUrl: url, timestamps: p.timestamps || [] } : { state: 'fail', errorCode: 'no_output' };
    }
    const url = typeof p.video_url === 'string' ? p.video_url : p.video && p.video.url;
    return typeof url === 'string' ? { state: 'success', outputUrl: url } : { state: 'fail', errorCode: 'no_output' };
}

/**
 * Apply one verified callback to its step.
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleStepCallback({ source, providerJobId, step, outcome, deps, cfg }) {
    if (outcome.state === 'pending') return { status: 200, body: { ok: true, pending: true } };
    const seen = await dedup(cfg, source, providerJobId, { step: step.step, state: outcome.state });
    if (seen === 'duplicate') return { status: 200, body: { ok: true, duplicate: true } };

    let result = await onStepOutcome({ step, outcome }, deps);
    if (!result.ok && result.error === 'asset_store_failed' && NON_RETRYABLE_COPY.test(String(result.detail || ''))) {
        console.error(`[auto-short] ${step.step} output unusable:`, result.detail);
        result = await onStepOutcome({ step, outcome: { state: 'fail', errorCode: 'asset_store_failed' } }, deps);
    }
    if (!result.ok) {
        // Not marked processed: the provider redelivers, and every step is idempotent.
        console.error(`[auto-short] ${step.step} callback not applied:`, result.error);
        return { status: 500, body: { error: 'step_not_applied' } };
    }
    await markProcessed(cfg, source, providerJobId);
    return { status: 200, body: { ok: true } };
}
