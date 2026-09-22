/**
 * Auto Short orchestrator — slice 3a of docs/auto-short/SPEC.md (ADR-0029).
 *
 * One parent `jobs` row carries the single debit. It is moved with the
 * existing state RPCs under provider 'veyrnox' and provider_job_id
 * `as_<job id>`, so job_submitted / job_stored / job_failed and
 * ledger_refund are reused unchanged and no provider webhook can ever match
 * it. Each provider call is a job_steps row (0091):
 *
 *   start          parent DEBITED ─► SUBMITTED; script (sync) ─► STORED;
 *                  voice + 4 scenes submitted in parallel
 *   onStepOutcome  a verified provider result for one step:
 *                    success ─► copy to R2 ─► step STORED ─► advance
 *                    failure ─► one re-submit, then step FAILED ─► refund
 *   advance        voice + 4 scenes STORED and no stitch yet ─► submit stitch
 *   stitch STORED  final MP4 ─► parent STORED with its asset
 *
 * Any unrecoverable failure fails the parent and refunds it in full
 * (ADR-0029 §5). Every step is idempotent, so a caller that errors may
 * safely be called again with the same input.
 *
 * All I/O comes in through `deps` so the logic is testable without a
 * network (tests/autoShort.test.mjs); slice 3b wires the real adapters.
 */

import { STEPS, SCENE_COUNT, stitchTracks, voiceLengthMs } from './autoShortSteps.js';
import { buildScriptRequest, parseScript, captionsVtt } from './autoShortScript.js';

export const PARENT_PROVIDER = 'veyrnox';
export const parentRef = (jobId) => `as_${jobId}`;
const CODE_RE = /^[a-z0-9_]{1,64}$/;
const code = (c, fallback) => (CODE_RE.test(String(c || '')) ? String(c) : fallback);

/** R2 key for a step's output: server ids only, never a provider path. */
export const stepKey = (jobId, step, ordinal, ext) => `auto-short/${jobId}/${step}-${ordinal}${ext}`;

/**
 * @typedef {object} Deps
 * @property {(name:string, args:object) => Promise<any>} rpc
 * @property {(jobId:string) => Promise<object[]>} steps        job_steps rows for the job
 * @property {(jobId:string) => Promise<{id:string,user_id:string,credits:number,state:string}|null>} job
 * @property {(body:object) => Promise<{ok:boolean, content?:string, error?:string}>} chat
 * @property {(provider:string, endpoint:string, inputs:object, jobId:string) => Promise<{ok:boolean, providerJobId?:string, error?:string}>} submit
 * @property {(url:string, key:string, provider:string, opts?:object) => Promise<{ok:boolean, r2Key?:string, size?:number, mimeType?:string, sha256?:string, error?:string}>} copy
 * @property {(key:string, text:string, contentType:string) => Promise<{ok:boolean}>} put
 * @property {(key:string) => Promise<string>} presign    15-minute GET URL on our own object
 */

/** Fail the parent and refund it once. Safe to repeat. */
export async function failParent(jobId, errorCode, deps) {
    const failed = await deps.rpc('job_failed', {
        p_provider_job_id: parentRef(jobId), p_provider: PARENT_PROVIDER, p_error_code: code(errorCode, 'auto_short_failed'),
    });
    let owed = failed && failed.ok ? { user_id: failed.user_id, credits: failed.credits } : null;
    if (!owed) {
        const job = await deps.job(jobId);
        if (!job || job.state !== 'FAILED') return { ok: false, code: 'parent_not_failable' };
        owed = job;
    }
    const refund = await deps.rpc('ledger_refund', {
        p_job_id: jobId, p_user_id: owed.user_id, p_credits: owed.credits, p_reason: 'refund:provider_failed',
    });
    if (!refund || refund.ok !== true) throw new Error(`auto-short refund rejected: ${refund && refund.code}`);
    return { ok: true, failed: true };
}

async function submitStep(jobId, step, ordinal, inputs, deps) {
    const spec = STEPS[step];
    const sent = await deps.submit(spec.provider, spec.endpoint, { ...inputs, ...spec.preset }, jobId);
    if (!sent.ok) return { ok: false, error: 'provider_submit_failed' };
    const rec = await deps.rpc('job_step_submitted', {
        p_job_id: jobId, p_step: step, p_ordinal: ordinal,
        p_provider: spec.provider, p_provider_endpoint: spec.endpoint, p_provider_job_id: sent.providerJobId,
    });
    return rec && rec.ok ? { ok: true } : { ok: false, error: String((rec && rec.code) || 'step_not_recorded').toLowerCase() };
}

/** Provider inputs for a step, rebuilt from the stored script. */
function stepInputs(step, ordinal, script) {
    if (step === 'voice') return { text: script.narration };
    if (step === 'scene') return { prompt: script.scenes[ordinal] };
    throw new Error(`no inputs for ${step}`);
}

/**
 * Kick off a debited Auto Short. `topic` has passed TOPIC_RE at the gateway.
 * @returns {Promise<{ok:boolean, failed?:boolean, error?:string}>}
 */
export async function start({ jobId, topic }, deps) {
    const sub = await deps.rpc('job_submitted', { p_job_id: jobId, p_provider: PARENT_PROVIDER, p_provider_job_id: parentRef(jobId) });
    if (!sub || !sub.ok) return { ok: false, error: 'parent_not_submittable' };

    const reply = await deps.chat(buildScriptRequest(topic));
    const parsed = reply.ok ? parseScript(reply.content) : { ok: false, error: 'script_failed' };
    if (!parsed.ok) return { ...(await failParent(jobId, parsed.error, deps)), error: parsed.error };

    const { endpoint, provider } = STEPS.script;
    const stored = await deps.rpc('job_step_stored', {
        p_job_id: jobId, p_step: 'script', p_ordinal: 0, p_provider: provider, p_provider_endpoint: endpoint,
        p_output_r2_key: null, p_output_text: parsed.script,
    });
    if (!stored || !stored.ok) return { ok: false, error: 'script_not_recorded' };

    const calls = [submitStep(jobId, 'voice', 0, stepInputs('voice', 0, parsed.script), deps)];
    for (let i = 0; i < SCENE_COUNT; i += 1) calls.push(submitStep(jobId, 'scene', i, stepInputs('scene', i, parsed.script), deps));
    const results = await Promise.all(calls);
    const bad = results.find((r) => !r.ok);
    if (bad) return { ...(await failParent(jobId, bad.error, deps)), error: bad.error };
    return { ok: true };
}

const scriptOf = (rows) => (rows.find((r) => r.step === 'script' && r.state === 'STORED') || {}).output_text || null;

/** Compose tracks from the stored voice and scenes, on fresh 15-minute URLs. */
async function stitchInputs(rows, deps) {
    const voice = rows.find((r) => r.step === 'voice' && r.state === 'STORED');
    const scenes = rows.filter((r) => r.step === 'scene' && r.state === 'STORED').sort((a, b) => a.ordinal - b.ordinal);
    if (!voice || scenes.length !== SCENE_COUNT) return null;
    const urls = await Promise.all(scenes.map((s) => deps.presign(s.output_r2_key)));
    const voiceUrl = await deps.presign(voice.output_r2_key);
    return { tracks: stitchTracks(urls, voiceUrl, (voice.output_text && voice.output_text.voice_ms) || 30000) };
}

/** Submit the stitch once the voice and all four scenes are stored. */
export async function advance(jobId, deps) {
    const rows = await deps.steps(jobId);
    if (rows.some((r) => r.step === 'stitch')) return { ok: true, waiting: false };
    const inputs = await stitchInputs(rows, deps);
    if (!inputs) return { ok: true, waiting: true };

    // ponytail: two webhooks finishing the last two scenes at the same instant
    // can both get here and submit two stitches; the second counts as the
    // re-submit and the first result is ignored. A claim row fixes it if it shows up.
    const sent = await submitStep(jobId, 'stitch', 0, inputs, deps);
    if (!sent.ok) return failParent(jobId, sent.error, deps);
    return { ok: true, waiting: false };
}

const EXT = { voice: '.mp3', scene: '.mp4', stitch: '.mp4' };

/**
 * A verified provider outcome for one job_steps row. The row came from our
 * (provider, provider_job_id) lookup; nothing here reads ids from a payload.
 * @param {{step:object, outcome:{state:'success', outputUrl:string, timestamps?:any[]}|{state:'fail', errorCode?:string}}} args
 */
export async function onStepOutcome({ step, outcome }, deps) {
    const { job_id: jobId, step: name, ordinal } = step;
    if (step.state !== 'SUBMITTED') return { ok: true, replay: true };
    // A parent that already failed (and was refunded) or finished takes no
    // more provider spend: no re-submit, no copy. Answering ok lets the
    // provider stop redelivering.
    const parent = await deps.job(jobId);
    if (!parent || parent.state !== 'SUBMITTED') return { ok: true, parentDone: true };

    if (outcome.state !== 'success') {
        if (step.attempts < 2) {
            const rows = await deps.steps(jobId);
            const script = scriptOf(rows);
            const inputs = name === 'stitch' ? await stitchInputs(rows, deps)
                : script ? stepInputs(name, ordinal, script) : null;
            const again = inputs ? await submitStep(jobId, name, ordinal, inputs, deps) : { ok: false };
            if (again.ok) return { ok: true, retried: true };
        }
        await deps.rpc('job_step_failed', { p_job_id: jobId, p_step: name, p_ordinal: ordinal, p_error_code: code(outcome.errorCode, 'provider_failed') });
        return failParent(jobId, `${name}_failed`, deps);
    }

    const key = stepKey(jobId, name, ordinal, EXT[name]);
    const copy = await deps.copy(outcome.outputUrl, key, step.provider, { expectMp4: name !== 'voice' });
    if (!copy.ok) return { ok: false, error: 'asset_store_failed', detail: copy.error };

    let text = null;
    if (name === 'voice') {
        const captionsKey = stepKey(jobId, 'captions', 0, '.vtt');
        const put = await deps.put(captionsKey, captionsVtt(outcome.timestamps), 'text/vtt');
        if (!put.ok) return { ok: false, error: 'asset_store_failed' };
        text = { voice_ms: voiceLengthMs(outcome.timestamps), captions_key: captionsKey };
    }
    const stored = await deps.rpc('job_step_stored', {
        p_job_id: jobId, p_step: name, p_ordinal: ordinal, p_provider: step.provider,
        p_provider_endpoint: step.provider_endpoint, p_output_r2_key: copy.r2Key, p_output_text: text,
    });
    if (!stored || !stored.ok) return { ok: false, error: 'step_not_recorded' };

    if (name !== 'stitch') return advance(jobId, deps);
    const done = await deps.rpc('job_stored', {
        p_provider_job_id: parentRef(jobId), p_provider: PARENT_PROVIDER,
        p_r2_key: copy.r2Key, p_mime_type: copy.mimeType, p_size_bytes: copy.size, p_sha256: copy.sha256,
    });
    return done && done.ok ? { ok: true, stored: true } : { ok: false, error: 'parent_not_stored' };
}
