// Percentage shown by the generation status bar.
//
// Providers report a job's state (queued, running, succeeded, failed), never
// how far along it is. So the percentage is an estimate from elapsed time
// against how long that kind of job usually takes. It rises quickly, slows
// down, and stops at CAP_PERCENT until the job really settles; only a
// succeeded job reaches 100. It never goes backwards.

export const CAP_PERCENT = 95;
// Matches how long JobWatcher tracks a job (jobHistory WATCH_MAX_AGE_MS), so a
// long run (Video Agent allows 45 min) keeps its row until it settles.
export const BAR_MAX_AGE_MS = 60 * 60 * 1000;

const SECOND = 1000;
// Measured end to end in live tests (see studioStates.js SLOW_MODEL_WAIT).
const MODEL_EXPECTED_MS = {
  'ace-step-1.5': 210 * SECOND,
  'mmaudio-v2': 180 * SECOND,
  'seedance-2.0-fast': 120 * SECOND,
  'auto-short-32s': 360 * SECOND,
};
const VIDEO_HINT = /(video|kling|seedance|veo|sora|wan|hailuo|runway|luma|pika|avatar|lipsync|swap)/i;
const AUDIO_HINT = /(audio|music|voice|tts|speech|sound|song)/i;
const IMAGE_MS = 40 * SECOND;
const AUDIO_MS = 60 * SECOND;
const VIDEO_MS = 150 * SECOND;

/** How long a job on this model usually takes, in ms. */
export function expectedDurationMs(modelId) {
  const id = typeof modelId === 'string' ? modelId : '';
  if (MODEL_EXPECTED_MS[id]) return MODEL_EXPECTED_MS[id];
  if (VIDEO_HINT.test(id)) return VIDEO_MS;
  if (AUDIO_HINT.test(id)) return AUDIO_MS;
  return IMAGE_MS;
}

/** 0 to CAP_PERCENT, a whole number, from time spent against the usual time. */
export function estimatePercent(elapsedMs, expectedMs) {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const expected = Number.isFinite(expectedMs) && expectedMs > 0 ? expectedMs : IMAGE_MS;
  const eased = CAP_PERCENT * (1 - Math.exp((-2.5 * elapsed) / expected));
  return Math.min(CAP_PERCENT, Math.max(0, Math.floor(eased)));
}

/** Entries the bar tracks: no outcome yet, and recent. */
export function barJobs(history, now = Date.now()) {
  return (history || []).filter(
    (r) => r && r.job_id && !r.settled && now - (r.submitted_at || 0) < BAR_MAX_AGE_MS,
  );
}

/** One row per tracked job, oldest first, each with its percentage. */
export function barRows(history, now = Date.now()) {
  return barJobs(history, now)
    .slice()
    .sort((a, b) => (a.submitted_at || 0) - (b.submitted_at || 0))
    .map((r) => ({
      job_id: r.job_id,
      label: r.name || r.prompt || '',
      percent: estimatePercent(now - (r.submitted_at || now), expectedDurationMs(r.model_id)),
    }));
}
