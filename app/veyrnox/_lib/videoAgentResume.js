// Which job the video agent page should pick up again after a reload.
//
// A run takes minutes and the page keeps the running job in memory only, so a reload (or the tab being discarded) lost the
// progress panel and the finished video; only the "ready" notice and the Library entry were left (staging, 2026-10-08).
// The job history in this browser already records what was started, so the page resumes from it.

/**
 * @param {Array<{job_id:string, model_id:string, credits:number}>} watchable  newest first, already limited to recent
 *   entries with no recorded outcome (jobHistory.jobsToWatch)
 * @param {string} modelId
 * @returns {{job_id:string, state:'queued', credits:number, model_id:string}|null}
 */
export function pickResumable(watchable, modelId) {
  const hit = (watchable || []).find((r) => r && r.model_id === modelId && typeof r.job_id === 'string' && r.job_id);
  if (!hit) return null;
  return { job_id: hit.job_id, state: 'queued', credits: Number(hit.credits) || 0, model_id: modelId };
}
