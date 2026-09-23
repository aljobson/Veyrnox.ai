/**
 * Clip Editor orchestrator (docs/editor/PRD.md), on ADR-0029's job_steps.
 *
 * One debited parent job (provider 'veyrnox', provider_job_id `ce_<job id>`,
 * so job_submitted / job_stored / job_failed / ledger_refund are reused as
 * Auto Short reuses them). Its steps run strictly one after another:
 *
 *   trim 0 -> trim 1 -> ... -> merge -> audio
 *
 * each only when its predecessor's webhook stores the output. Only one step
 * is ever in flight, so two callbacks can never race to submit the next one
 * (main's job_steps has no claim yet: see the #230 comment). The cost is
 * latency, about 6 s per trim (§9), which the 10-clip cap bounds.
 *
 * Only the endpoints Slice 0 proved exact are used: trim-video, merge-videos,
 * merge-audio-video. `compose` was rejected (§9).
 */

import { PARENT_PROVIDER } from './autoShort.js';

export const CLIP_EDIT_MODEL = 'clip-edit';
export const MAX_CLIPS = 10;
export const MAX_OUTPUT_S = 60;
const UNIT_SECONDS = 5;
const PARENT_PREFIX = 'ce_';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EDIT_STEPS = new Set(['trim', 'merge', 'audio']);
const ENDPOINT = {
    trim: 'fal-ai/workflow-utilities/trim-video',
    merge: 'fal-ai/ffmpeg-api/merge-videos',
    audio: 'fal-ai/ffmpeg-api/merge-audio-video',
};

export const parentRef = (jobId) => `${PARENT_PREFIX}${jobId}`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/**
 * Validate the edit at the boundary. Ownership, media kind and the real
 * source durations are resolved by the caller (the gateway), which passes
 * each clip's `duration_s` and its R2 `key`; nothing here trusts the client.
 * @returns {{ok:true, clips:object[], audio:object|null, output_s:number}|{ok:false,error:string}}
 */
export function validateEdit({ clips, audio }) {
    if (!Array.isArray(clips) || clips.length < 1 || clips.length > MAX_CLIPS) return { ok: false, error: 'clips_count' };
    const out = [];
    let total = 0;
    for (const c of clips) {
        const inS = num(c && c.in_s);
        const outS = num(c && c.out_s);
        const dur = num(c && c.duration_s);
        if (!(typeof c.key === 'string' && c.key)) return { ok: false, error: 'clip_source' };
        if (!(inS >= 0 && outS > inS && outS <= dur + 0.05)) return { ok: false, error: 'clip_range' };
        if (c.aspect && out[0] && out[0].aspect && c.aspect !== out[0].aspect) return { ok: false, error: 'mixed_aspect' };
        out.push({ key: c.key, in_s: inS, out_s: outS, whole: inS === 0 && outS >= dur - 0.05, aspect: c.aspect || null });
        total += outS - inS;
    }
    if (total > MAX_OUTPUT_S + 0.05) return { ok: false, error: 'too_long' };
    let a = null;
    if (audio) {
        const off = num(audio.offset_s);
        if (!(typeof audio.key === 'string' && audio.key) || !(off >= 0 && off < total)) return { ok: false, error: 'audio_invalid' };
        a = { key: audio.key, offset_s: off };
    }
    if (out.length === 1 && out[0].whole && !a) return { ok: false, error: 'nothing_to_do' };
    // Rounded so float sums (1.1 + 3.9) never tip the price into another 5 s unit.
    return { ok: true, clips: out, audio: a, output_s: Math.round(total * 1000) / 1000 };
}

/** The ordered plan. trim steps only for clips not used whole. */
export function planEdit(edit) {
    const plan = [];
    edit.clips.forEach((c, i) => { if (!c.whole) plan.push({ step: 'trim', ordinal: i }); });
    if (edit.clips.length > 1) plan.push({ step: 'merge', ordinal: 0 });
    if (edit.audio) plan.push({ step: 'audio', ordinal: 0 });
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
    return Math.max(1, seconds, planEdit(edit).length);
}

const keyOf = (rows, step, ordinal) => (rows.find((r) => r.step === step && r.ordinal === ordinal && r.state === 'STORED') || {}).output_r2_key;

/** Inputs for one step, reading earlier outputs from the stored rows. */
async function stepInputs(edit, next, rows, deps) {
    // The current video for clip i: its trim output if it was trimmed, else its source.
    const clipUrl = async (i) => deps.presign(edit.clips[i].whole ? edit.clips[i].key : keyOf(rows, 'trim', i));
    if (next.step === 'trim') {
        const c = edit.clips[next.ordinal];
        return { video_url: await deps.presign(c.key), start_time: c.in_s, end_time: c.out_s };
    }
    if (next.step === 'merge') {
        return { video_urls: await Promise.all(edit.clips.map((_, i) => clipUrl(i))) };
    }
    // audio: over the merge output, or the single clip.
    const video = edit.clips.length > 1 ? await deps.presign(keyOf(rows, 'merge', 0)) : await clipUrl(0);
    return { video_url: video, audio_url: await deps.presign(edit.audio.key), start_offset: edit.audio.offset_s };
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
        if (step.attempts < 2) {
            const again = await submitStep(jobId, edit, { step: name, ordinal }, await deps.steps(jobId), deps, { retry: true });
            if (again.ok) return { ok: true, retried: true };
        }
        await deps.rpc('job_step_failed', { p_job_id: jobId, p_step: name, p_ordinal: ordinal, p_error_code: 'provider_failed' });
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
