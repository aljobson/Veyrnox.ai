/**
 * Clip Editor orchestrator (docs/editor/PRD.md), on ADR-0029's job_steps.
 *
 * One debited parent job (provider 'veyrnox', provider_job_id `ce_<job id>`,
 * so job_submitted / job_stored / job_failed / ledger_refund are reused as
 * Auto Short reuses them). Its steps run strictly one after another:
 *
 *   [trim i -> slow i] per clip -> merge -> audio -> captions
 *
 * each only when its predecessor's webhook stores the output. Only one step
 * is ever in flight, so two callbacks can never race to submit the next one
 * (main's job_steps has no claim yet: see the #230 comment). The cost is
 * latency, about 6 s per trim (§9), which the 10-clip cap bounds.
 *
 * Only the endpoints Slice 0 proved exact are used: trim-video, merge-videos,
 * merge-audio-video, for captions veed/subtitles (docs/editor/CAPTIONS.md, probed
 * live 2026-10-07) and for slow motion topaz/interpolate/video (docs/editor/SPEED.md,
 * probed live 2026-10-09). `compose` was rejected (§9).
 */

import { PARENT_PROVIDER } from './autoShort.js';

export const CLIP_EDIT_MODEL = 'clip-edit';
export const MAX_CLIPS = 10;
export const MAX_OUTPUT_S = 60;
const UNIT_SECONDS = 5;
const PARENT_PREFIX = 'ce_';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EDIT_STEPS = new Set(['trim', 'slow', 'merge', 'audio', 'captions']);
const ENDPOINT = {
    trim: 'fal-ai/workflow-utilities/trim-video',
    merge: 'fal-ai/ffmpeg-api/merge-videos',
    audio: 'fal-ai/ffmpeg-api/merge-audio-video',
    captions: 'veed/subtitles',
    slow: 'topaz/interpolate/video',
};

// veed/subtitles requires one of these (its live input schema, 2026-10-07).
export const CAPTION_PRESETS = Object.freeze([
    'glass', 'whisper', 'glide2', 'fusion', 'glide', 'terminal', 'handwritten', 'backdrop', 'backdrop2', 'simple',
    'plain', 'beans', 'corpo', 'boo', 'shadeplay', 'casper', 'capri', 'lowkey', 'vinta', 'diego', 'ali', 'slay',
    'kitty', 'hustle', 'karl', 'sprout', 'flex', 'mint', 'rizz', 'vegas',
]);
export const DEFAULT_CAPTION_PRESET = 'simple';

export const clipCaptionsEnabled = (env) => !!env && env.CLIP_EDIT_CAPTIONS_ENABLED === 'true';

// Slow motion (docs/editor/SPEED.md). Only factors 2 to 4 are allowed: the probe ran factor 2
// alone, and fal bills the extra generated frames, so higher factors are unmeasured cost.
export const SLOW_FACTORS = Object.freeze([2, 3, 4]);
// The probe's frame rate (24, on a 24 fps clip). fal bills generated frames, so it is not left at its 60 default.
const SLOW_TARGET_FPS = 24;
// Seconds of source video that may be slowed in one edit. Bounds the worst-case provider spend, whose
// real unit (per second of video?) is not yet read from fal's invoice.
export const SLOW_MAX_SOURCE_S = 15;
/**
 * PLACEHOLDER PRICE, deliberately high. fal's page lists $0.30 to $0.60 for this endpoint with the unit
 * unclear (the sibling Topaz upscale bills per second of video), and the billed amount of the three probe
 * runs has not been read. So each slowed clip counts this many billed units per started second of source
 * video it keeps: at $0.033 a credit, 20 credits is $0.66 a second against a worst case of $0.30 a second,
 * over the ADR-0014 50% floor even if the unit is per second. Lower it only after fal's invoice says what a
 * run costs; the flag stays off until then. The unit price itself stays in the catalog.
 */
export const SLOW_UNITS_PER_SECOND = 20;

export const clipSlowEnabled = (env) => !!env && env.CLIP_EDIT_SLOW_ENABLED === 'true';

const slowOf = (clip) => (clip && clip.slow > 1 ? clip.slow : 1);

/**
 * The captions call is billed by fal per started minute (about $0.10, a
 * 1-minute minimum, so a 5 s clip costs what a 60 s one does) while our unit is
 * 5 s of output. So captions count as this many billed units on their own, the
 * same way each other step counts as one (editUnits): at the $0.033 credit
 * rate, 7 credits is $0.231 against about $0.10, over the ADR-0014 50% floor.
 * The unit price stays in the catalog. Derived from the probed, not yet
 * invoiced, cost: re-check against fal's usage page before turning it on.
 */
export const CAPTIONS_UNITS = 7;

const NO_RETRY_STEPS = new Set(['captions', 'slow']);

export const parentRef = (jobId) => `${PARENT_PREFIX}${jobId}`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/**
 * Validate the edit at the boundary. Ownership, media kind and the real
 * source durations are resolved by the caller (the gateway), which passes
 * each clip's `duration_s` and its R2 `key`; nothing here trusts the client.
 * @returns {{ok:true, clips:object[], audio:object|null, captions:{preset:string}|null, output_s:number}|{ok:false,error:string}}
 */
export function validateEdit({ clips, audio, captions }) {
    if (!Array.isArray(clips) || clips.length < 1 || clips.length > MAX_CLIPS) return { ok: false, error: 'clips_count' };
    const out = [];
    let total = 0;
    let slowedSource = 0;
    for (const c of clips) {
        const inS = num(c && c.in_s);
        const outS = num(c && c.out_s);
        const dur = num(c && c.duration_s);
        if (!(typeof c.key === 'string' && c.key)) return { ok: false, error: 'clip_source' };
        if (!(inS >= 0 && outS > inS && outS <= dur + 0.05)) return { ok: false, error: 'clip_range' };
        const slow = c.slow === undefined ? 1 : c.slow;
        if (slow !== 1 && !SLOW_FACTORS.includes(slow)) return { ok: false, error: 'slow_invalid' };
        if (c.aspect && out[0] && out[0].aspect && c.aspect !== out[0].aspect) return { ok: false, error: 'mixed_aspect' };
        out.push({ key: c.key, in_s: inS, out_s: outS, whole: inS === 0 && outS >= dur - 0.05, aspect: c.aspect || null, ...(slow > 1 ? { slow } : {}) });
        // A slowed clip runs `slow` times longer in the result.
        total += (outS - inS) * slow;
        if (slow > 1) slowedSource += outS - inS;
    }
    if (slowedSource > SLOW_MAX_SOURCE_S + 0.05) return { ok: false, error: 'slow_too_long' };
    if (total > MAX_OUTPUT_S + 0.05) return { ok: false, error: 'too_long' };
    // A slowed clip's own sound is not slowed with it (docs/editor/SPEED.md): left alone it would run out of
    // step and then stop. The audio step replaces it, so slow motion needs a soundtrack.
    if (slowedSource > 0 && !audio) return { ok: false, error: 'slow_needs_audio' };
    let a = null;
    if (audio) {
        const off = num(audio.offset_s);
        if (!(typeof audio.key === 'string' && audio.key) || !(off >= 0 && off < total)) return { ok: false, error: 'audio_invalid' };
        a = { key: audio.key, offset_s: off };
    }
    let c = null;
    if (captions) {
        if (typeof captions.preset !== 'string' || !CAPTION_PRESETS.includes(captions.preset)) return { ok: false, error: 'captions_invalid' };
        c = { preset: captions.preset };
    }
    if (out.length === 1 && out[0].whole && !out[0].slow && !a && !c) return { ok: false, error: 'nothing_to_do' };
    // Rounded so float sums (1.1 + 3.9) never tip the price into another 5 s unit.
    return { ok: true, clips: out, audio: a, captions: c, output_s: Math.round(total * 1000) / 1000 };
}

/** The ordered plan. trim steps only for clips not used whole. */
export function planEdit(edit) {
    const plan = [];
    // Trim before slowing, so only the kept part is slowed (and paid for).
    edit.clips.forEach((c, i) => {
        if (!c.whole) plan.push({ step: 'trim', ordinal: i });
        if (slowOf(c) > 1) plan.push({ step: 'slow', ordinal: i });
    });
    if (edit.clips.length > 1) plan.push({ step: 'merge', ordinal: 0 });
    if (edit.audio) plan.push({ step: 'audio', ordinal: 0 });
    // Last, so the captions are transcribed from the audio the viewer hears.
    if (edit.captions) plan.push({ step: 'captions', ordinal: 0 });
    return plan;
}

/**
 * Billed units of UNIT_SECONDS for an edit: the greater of its output length
 * and its step count.
 *
 * Output length alone under-prices a many-clip edit, because the provider
 * cost scales with steps, not seconds: ten 0.3 s clips is 3 s of output (one
 * unit) but twelve fal calls, which at about $0.005 a trim sits under the
 * ADR-0014 floor. One unit per step keeps every shape above it. The unit
 * price itself stays in the catalog (`credits_5s`); this only counts units.
 */
export function editUnits(edit) {
    const seconds = Math.ceil((edit.output_s || 0) / UNIT_SECONDS);
    // Captions are one call but cost CAPTIONS_UNITS units (see above); a slowed clip costs
    // SLOW_UNITS_PER_SECOND per started second of source it keeps.
    const steps = planEdit(edit).reduce((n, p) => {
        if (p.step === 'captions') return n + CAPTIONS_UNITS;
        if (p.step === 'slow') {
            const c = edit.clips[p.ordinal];
            return n + SLOW_UNITS_PER_SECOND * Math.ceil(c.out_s - c.in_s - 1e-9);
        }
        return n + 1;
    }, 0);
    return Math.max(1, seconds, steps);
}

const keyOf = (rows, step, ordinal) => (rows.find((r) => r.step === step && r.ordinal === ordinal && r.state === 'STORED') || {}).output_r2_key;

/** Inputs for one step, reading earlier outputs from the stored rows. */
async function stepInputs(edit, next, rows, deps) {
    // The current video for clip i: its slow output if it was slowed, else its trim output if it was
    // trimmed, else its source.
    const clipKey = (i) => {
        const c = edit.clips[i];
        if (slowOf(c) > 1) return keyOf(rows, 'slow', i);
        return c.whole ? c.key : keyOf(rows, 'trim', i);
    };
    const clipUrl = async (i) => deps.presign(clipKey(i));
    if (next.step === 'trim') {
        const c = edit.clips[next.ordinal];
        return { video_url: await deps.presign(c.key), start_time: c.in_s, end_time: c.out_s };
    }
    if (next.step === 'slow') {
        const i = next.ordinal;
        const c = edit.clips[i];
        // Slow what the trim step left, or the whole source when the clip is used whole.
        const from = c.whole ? c.key : keyOf(rows, 'trim', i);
        return { video_url: await deps.presign(from), slowdown_factor: slowOf(c), target_fps: SLOW_TARGET_FPS, model: 'Apollo', H264_output: true };
    }
    if (next.step === 'merge') {
        return { video_urls: await Promise.all(edit.clips.map((_, i) => clipUrl(i))) };
    }
    // The video so far: the merge output (several clips) or the single clip.
    const joined = edit.clips.length > 1 ? await deps.presign(keyOf(rows, 'merge', 0)) : await clipUrl(0);
    if (next.step === 'audio') {
        return { video_url: joined, audio_url: await deps.presign(edit.audio.key), start_offset: edit.audio.offset_s };
    }
    // captions: over the audio step's output when there is one.
    const video = edit.audio ? await deps.presign(keyOf(rows, 'audio', 0)) : joined;
    return { video_url: video, preset: edit.captions.preset };
}

/**
 * @param {{retry?: boolean}} [opts] a retry re-submits a row this caller
 *   already owns, so it skips the claim.
 */
async function submitStep(jobId, edit, next, rows, deps, opts = {}) {
    if (!opts.retry) {
        // Claim before paying: a callback and the sweep can hold the same
        // finished step at once, and both would otherwise submit this one
        // (#230). The loser of the UNIQUE insert never calls fal.
        const claim = await deps.rpc('job_step_claim', {
            p_job_id: jobId, p_step: next.step, p_ordinal: next.ordinal,
            p_provider: 'fal', p_provider_endpoint: ENDPOINT[next.step],
        });
        if (!claim || claim.ok !== true) return { ok: false, error: 'step_not_claimable' };
        if (claim.claimed !== true) return { ok: true, raced: true };
    }
    const inputs = await stepInputs(edit, next, rows, deps);
    const sent = await deps.submit('fal', ENDPOINT[next.step], inputs, jobId);
    if (!sent.ok) return { ok: false, error: 'provider_submit_failed' };
    const rec = await deps.rpc('job_step_submitted', {
        p_job_id: jobId, p_step: next.step, p_ordinal: next.ordinal, p_provider: 'fal',
        p_provider_endpoint: ENDPOINT[next.step], p_provider_job_id: sent.providerJobId,
    });
    return rec && rec.ok ? { ok: true } : { ok: false, error: 'step_not_recorded' };
}

async function failParent(jobId, errorCode, deps) {
    const failed = await deps.rpc('job_failed', { p_provider_job_id: parentRef(jobId), p_provider: PARENT_PROVIDER, p_error_code: errorCode });
    const job = await deps.job(jobId);
    if (!job) return { ok: false, error: 'parent_missing' };
    if (!(failed && failed.ok) && job.state !== 'FAILED') return { ok: true, parentDone: true };
    const refund = await deps.rpc('ledger_refund', { p_job_id: jobId, p_user_id: job.user_id, p_credits: job.credits, p_reason: 'refund:provider_failed' });
    return refund && refund.ok ? { ok: true, refunded: true } : { ok: false, error: 'refund_failed' };
}

/** The next step in the plan that has no STORED row, or null when done. */
function nextStep(plan, rows) {
    return plan.find((p) => !rows.some((r) => r.step === p.step && r.ordinal === p.ordinal && r.state === 'STORED')) || null;
}

/** Called from the gateway right after the debit. Submits the first step. */
export async function start({ jobId, edit }, deps) {
    if (!UUID_RE.test(String(jobId))) return { ok: false, error: 'bad_job' };
    const sub = await deps.rpc('job_submitted', { p_job_id: jobId, p_provider: PARENT_PROVIDER, p_provider_job_id: parentRef(jobId) });
    if (!sub || !sub.ok) return { ok: false, error: 'parent_not_submittable' };
    const first = planEdit(edit)[0];
    const r = await submitStep(jobId, edit, first, [], deps);
    if (!r.ok) {
        await failParent(jobId, 'submit_failed', deps);
        return r;
    }
    return { ok: true };
}

/**
 * A verified step callback. The edit is read back from the parent's
 * jobs.inputs (validated before the debit), so the plan is rebuilt
 * deterministically from our own row, never from the payload.
 */
export async function onStepOutcome({ step, outcome }, deps) {
    const { job_id: jobId, step: name, ordinal } = step;
    if (step.state !== 'SUBMITTED') return { ok: true, replay: true };
    const parent = await deps.job(jobId);
    if (!parent || parent.state !== 'SUBMITTED') return { ok: true, parentDone: true };
    const edit = parent.inputs && parent.inputs.edit;
    if (!edit || !Array.isArray(edit.clips)) return failParent(jobId, 'edit_missing', deps);

    if (outcome.state !== 'success') {
        // Captions and slow motion are the dear steps and fail deterministically (no speech is a 422 fal
        // may bill), so a second attempt would only spend again on the same clip. The one exception is fal
        // not reaching our signed URL (`transient`), which fails before any work is done and works on the
        // next call.
        if (outcome.reason) console.error(`[clip-edit] ${name} step failed: ${outcome.reason}`);
        if ((!NO_RETRY_STEPS.has(name) || outcome.transient === true) && step.attempts < 2) {
            const again = await submitStep(jobId, edit, { step: name, ordinal }, await deps.steps(jobId), deps, { retry: true });
            if (again.ok) return { ok: true, retried: true };
        }
        await deps.rpc('job_step_failed', { p_job_id: jobId, p_step: name, p_ordinal: ordinal, p_error_code: outcome.reason || 'provider_failed' });
        return failParent(jobId, `${name}_failed`, deps);
    }

    const key = `edits/${jobId}/${name}-${ordinal}.mp4`;
    const copy = await deps.copy(outcome.outputUrl, key, step.provider, { expectMp4: true });
    if (!copy.ok) return { ok: false, error: 'asset_store_failed', detail: copy.error };
    const stored = await deps.rpc('job_step_stored', {
        p_job_id: jobId, p_step: name, p_ordinal: ordinal, p_provider: step.provider,
        p_provider_endpoint: step.provider_endpoint, p_output_r2_key: copy.r2Key, p_output_text: null,
    });
    if (!stored || !stored.ok) return { ok: false, error: 'step_not_recorded' };

    const rows = await deps.steps(jobId);
    const next = nextStep(planEdit(edit), rows);
    if (next) {
        const r = await submitStep(jobId, edit, next, rows, deps);
        if (r.ok) return { ok: true, advanced: next.step };
        return failParent(jobId, 'submit_failed', deps);
    }
    const done = await deps.rpc('job_stored', {
        p_provider_job_id: parentRef(jobId), p_provider: PARENT_PROVIDER,
        p_r2_key: copy.r2Key, p_mime_type: copy.mimeType, p_size_bytes: copy.size, p_sha256: copy.sha256,
    });
    return done && done.ok ? { ok: true, stored: true } : { ok: false, error: 'parent_not_stored' };
}
