// Fills in the real length of the caller's newest stored MP4s (migration 0513) before
// Your wins sums "Video made". The length comes from the file's own headers, the same
// reader as /api/v1/jobs/:id/media-info. A file whose headers cannot be read is marked
// once and not retried; a read that throws (timeout, network) is left for next time.
import { isUuidLoose } from './validate.js';

export const MEASURE_LIMIT = 6;
export const MEASURE_BUDGET_MS = 4000;

const lengthMs = info => (info && Number.isFinite(info.seconds) && info.seconds > 0 ? Math.max(1, Math.round(info.seconds * 1000)) : null);

/**
 * @param {string} authId
 * @param {{ rpc: (name: string, body: object) => Promise<unknown>, mp4: (key: string, size: number) => Promise<{ seconds?: number } | null> }} deps
 * @returns {Promise<number>} how many lengths were recorded
 */
export async function measureNewVideos(authId, deps, { limit = MEASURE_LIMIT, budgetMs = MEASURE_BUDGET_MS } = {}) {
    const list = await deps.rpc('list_unmeasured_videos', { p_auth_id: authId, p_limit: limit });
    if (!Array.isArray(list)) return 0;
    const one = async video => {
        if (!video || !isUuidLoose(video.job_id) || typeof video.r2_key !== 'string' || !(Number(video.size_bytes) > 0)) return 0;
        let info;
        try { info = await deps.mp4(video.r2_key, Number(video.size_bytes)); } catch { return 0; }
        const result = await deps.rpc('record_video_duration', { p_auth_id: authId, p_job_id: video.job_id, p_r2_key: video.r2_key, p_duration_ms: lengthMs(info) });
        return result?.recorded === true && lengthMs(info) ? 1 : 0;
    };
    let timer;
    const budget = new Promise(resolve => { timer = setTimeout(() => resolve(null), budgetMs); });
    const done = Promise.all(list.slice(0, limit).map(v => one(v).catch(() => 0))).then(counts => counts.reduce((a, b) => a + b, 0));
    try { return (await Promise.race([done, budget])) ?? 0; } finally { clearTimeout(timer); }
}
