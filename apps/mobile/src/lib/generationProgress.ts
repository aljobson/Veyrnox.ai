// Percentage shown while a generation runs. Mirrors the website's
// app/veyrnox/_lib/generationProgress.mjs so both apps show the same figure.
//
// Providers report a job's state (queued, running, succeeded, failed), never how
// far along it is, and the job API returns no progress field. So the figure is an
// estimate from elapsed time against how long that kind of job usually takes. It
// rises quickly, slows down and stops at CAP_PERCENT until the job settles; only a
// succeeded job is shown at 100. It never goes backwards.

export const CAP_PERCENT = 95;

const SECOND = 1000;
// Measured end to end in live tests (same table as the website).
const MODEL_EXPECTED_MS: Readonly<Record<string, number>> = {
    'ace-step-1.5': 210 * SECOND,
    'mmaudio-v2': 180 * SECOND,
    'seedance-2.0-fast': 120 * SECOND,
    'auto-short-32s': 360 * SECOND,
};
const VIDEO_HINT = /(video|kling|seedance|veo|sora|wan|hailuo|runway|luma|pika|avatar|lipsync|swap|agent|reel|film)/i;
const AUDIO_HINT = /(audio|music|voice|tts|speech|sound|song)/i;
const IMAGE_MS = 40 * SECOND;
const AUDIO_MS = 60 * SECOND;
const VIDEO_MS = 150 * SECOND;

export type ProgressKind = 'image' | 'video' | 'audio';

/** How long a job on this model (or of this kind, when the model is not known yet) usually takes, in ms. */
export function expectedDurationMs(modelId?: string | null, kind?: ProgressKind | null): number {
    const id = typeof modelId === 'string' ? modelId : '';
    if (MODEL_EXPECTED_MS[id]) return MODEL_EXPECTED_MS[id];
    if (VIDEO_HINT.test(id)) return VIDEO_MS;
    if (AUDIO_HINT.test(id)) return AUDIO_MS;
    if (!id && kind === 'video') return VIDEO_MS;
    if (!id && kind === 'audio') return AUDIO_MS;
    return IMAGE_MS;
}

/** 0 to CAP_PERCENT, a whole number, from time spent against the usual time. */
export function estimatePercent(elapsedMs: number, expectedMs: number): number {
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    const expected = Number.isFinite(expectedMs) && expectedMs > 0 ? expectedMs : IMAGE_MS;
    const eased = CAP_PERCENT * (1 - Math.exp((-2.5 * elapsed) / expected));
    return Math.min(CAP_PERCENT, Math.max(0, Math.floor(eased)));
}

// When this device first saw each job, so the bar does not restart at 0 when the
// person moves from Create's result card to the job screen. In memory only: job ids
// are random UUIDs, and after a restart the bar simply starts from when it is shown.
// The model is kept too, so a screen that only has the job id still uses the right duration.
const MAX_REMEMBERED = 100;
type Started = { readonly at: number; readonly modelId?: string };
let started: ReadonlyMap<string, Started> = new Map();

/** Records when a job was submitted or first shown. The first time wins. */
export function noteJobStarted(jobId: string, at: number = Date.now(), modelId?: string): number {
    const known = started.get(jobId);
    if (known !== undefined) return known.at;
    const entries = [...started.entries(), [jobId, { at, modelId }] as const].slice(-MAX_REMEMBERED);
    started = new Map(entries);
    return at;
}

export function jobStartedAt(jobId: string): number | undefined {
    return started.get(jobId)?.at;
}

export function jobModelId(jobId: string): string | undefined {
    return started.get(jobId)?.modelId;
}

/** Elapsed whole seconds since a start time. */
export function elapsedSeconds(startedAt: number, now: number): number {
    return Math.max(0, Math.floor((now - startedAt) / SECOND));
}
