import { isUuidLoose } from './validate.js';
import { validDimension } from './videoShape.mjs';

export const validShapeIds = body => !!body && !Array.isArray(body) && Object.keys(body).length === 1
    && Array.isArray(body.job_ids) && body.job_ids.length >= 1 && body.job_ids.length <= 12
    && body.job_ids.every(id => typeof id === 'string' && isUuidLoose(id))
    && new Set(body.job_ids.map(id => id.toLowerCase())).size === body.job_ids.length;
let warnedMissing = false;
export function missingShapeRpc(error) {
    return ['PGRST202', '42883'].includes(error?.body?.code);
}
export function logMissingShapeRpc() {
    if (!warnedMissing) { warnedMissing = true; console.warn('[jobs/shapes] migration 0577 unavailable'); }
}
export function publicShapeFields(job) {
    if (job.shape_ambiguous === true) return { shape_ambiguous: true };
    return job.state === 'STORED' && job.has_asset && !job.held && validDimension(job.video_width) && validDimension(job.video_height)
        ? { video_width: job.video_width, video_height: job.video_height, ...(job.shape_ambiguous === false ? { shape_ambiguous: false } : {}) }
        : job.shape_ambiguous === false ? { shape_ambiguous: false } : {};
}

export async function measureVideoShapes(authId, ids, deps, { budgetMs = 4000 } = {}) {
    const deadline = Date.now() + budgetMs;
    let stopped = false, timer;
    const shapes = [];
    const work = async () => {
        const list = await deps.rpc('list_unmeasured_video_shapes', { p_auth_id: authId, p_job_ids: ids });
        if (!Array.isArray(list)) throw new Error('invalid_shape_list');
        let cursor = 0;
        const oneWorker = async () => {
            while (!stopped && Date.now() < deadline && cursor < Math.min(12, list.length)) {
                const video = list[cursor++];
                if (!video || !ids.includes(video.job_id) || typeof video.r2_key !== 'string' || !(Number(video.size_bytes) > 0)) continue;
                let info;
                try { info = await deps.mp4(video.r2_key, Number(video.size_bytes)); } catch { continue; }
                if (stopped || Date.now() >= deadline) return;
                const valid = validDimension(info?.width) && validDimension(info?.height);
                const result = await deps.rpc('record_video_shape', { p_auth_id: authId, p_job_id: video.job_id, p_r2_key: video.r2_key,
                    p_width: valid ? info.width : null, p_height: valid ? info.height : null });
                if (!stopped && result?.recorded === true && valid) shapes.push({ job_id: video.job_id, width: info.width, height: info.height });
            }
        };
        await Promise.all(Array.from({ length: 4 }, oneWorker));
    };
    try {
        await Promise.race([work(), new Promise(resolve => { timer = setTimeout(resolve, budgetMs); })]);
        return shapes.slice();
    } catch (error) {
        if (!missingShapeRpc(error)) throw error;
        logMissingShapeRpc();
        return [];
    } finally { stopped = true; clearTimeout(timer); }
}
