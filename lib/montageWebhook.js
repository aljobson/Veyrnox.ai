/**
 * Runner callbacks for the video agent (ADR-0074 §4). The route verifies the
 * HMAC first, then looks the step up by `mr_<job id>` (lib/autoShortRuntime
 * findStep); user, job and key all come from our rows, never the payload.
 *
 * Events: `upload_url` (the runner asks for a fresh PUT URL for the one key
 * we own, because a URL minted at start would expire during a long run),
 * `completed` {bytes, sha256}, `failed` {error_code}, `progress` (ignored).
 */

import { onStepOutcome, outputKey, TIMEOUT_MINUTES } from './montage.js';
import { dedup, markProcessed } from './providerCompletion.js';

export const SOURCE = 'montage';
export const UPLOAD_TTL_SECONDS = 15 * 60;
const ERROR_CODE_RE = /^[a-z0-9_]{1,64}$/;

/** @returns {{type:'upload_url'|'progress'}|{type:'completed', bytes:number, sha256:string}|{type:'failed', errorCode:string}|null} */
export function parseEvent(body) {
    if (!body || typeof body !== 'object') return null;
    switch (body.event) {
        case 'upload_url': return { type: 'upload_url' };
        case 'progress': return { type: 'progress' };
        case 'completed': return { type: 'completed', bytes: body.bytes, sha256: body.sha256 };
        case 'failed': return { type: 'failed', errorCode: ERROR_CODE_RE.test(String(body.error_code || '')) ? body.error_code : 'runner_failed' };
        default: return null;
    }
}

/**
 * @param {{event:object, step:object, deps:object, cfg:object}} args
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleRunnerEvent({ event, step, deps, cfg }) {
    if (event.type === 'progress') return { status: 200, body: { ok: true } };

    if (event.type === 'upload_url') {
        if (step.state !== 'SUBMITTED') return { status: 409, body: { error: 'step_not_running' } };
        const parent = await deps.job(step.job_id);
        if (!parent || parent.state !== 'SUBMITTED') return { status: 409, body: { error: 'job_not_running' } };
        const key = outputKey(step.job_id);
        const url = await deps.presignPut(key, 'video/mp4', UPLOAD_TTL_SECONDS);
        return { status: 200, body: { upload_url: url, content_type: 'video/mp4', expires_seconds: UPLOAD_TTL_SECONDS } };
    }

    const outcome = event.type === 'completed'
        ? { state: 'success', bytes: event.bytes, sha256: event.sha256 }
        : { state: 'fail', errorCode: event.errorCode };
    const seen = await dedup(cfg, SOURCE, step.provider_job_id, { state: outcome.state });
    if (seen === 'duplicate') return { status: 200, body: { ok: true, duplicate: true } };

    const result = await onStepOutcome({ step, outcome }, deps);
    if (!result.ok) {
        // Not marked processed: the runner redelivers, and every step is idempotent.
        console.error('[video-agent] callback not applied:', result.error);
        return { status: 500, body: { error: 'step_not_applied' } };
    }
    await markProcessed(cfg, SOURCE, step.provider_job_id);
    return { status: 200, body: { ok: true } };
}

/** Sweep helper: age past TIMEOUT_MINUTES counts as a failed run. */
export const isTimedOut = (step, now) => (now.getTime() - new Date(step.updated_at).getTime()) / 60_000 > TIMEOUT_MINUTES;
