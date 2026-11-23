// Frozen 720p contract. Only the adapter emits edit's duration=-1.
export const SEEDANCE_25_MODEL = 'bytedance/seedance2-5-r2v';
export const seedance25Task = model => model === `${SEEDANCE_25_MODEL}:edit` ? 'edit'
    : model === `${SEEDANCE_25_MODEL}:extend` ? 'extend' : null;
export function buildSeedance25Request(task, inputs) {
    if (!['edit', 'extend'].includes(task)) return { ok: false, error: 'provider_unsupported' };
    const allowed = new Set(['prompt', 'video_url', 'resolution', 'aspect_ratio', ...(task === 'extend' ? ['duration_seconds'] : [])]);
    const extra = Object.keys(inputs).find(key => !allowed.has(key));
    if (extra) return { ok: false, error: `inputs_key_not_allowed:${extra.slice(0, 32)}` };
    if (inputs.resolution !== undefined && inputs.resolution !== '720p') return { ok: false, error: 'resolution_not_supported' };
    if (inputs.aspect_ratio !== undefined && inputs.aspect_ratio !== 'auto') return { ok: false, error: 'aspect_ratio_unsupported' };
    if (inputs.duration_seconds !== undefined && inputs.duration_seconds !== 5) return { ok: false, error: 'duration_not_supported' };
    const videos = inputs.video_url === undefined ? [] : Array.isArray(inputs.video_url) ? inputs.video_url : [inputs.video_url];
    if (videos.length !== 1) return { ok: false, error: 'source_count_exceeded' };
    try {
        if (typeof videos[0] !== 'string' || new URL(videos[0]).protocol !== 'https:') throw new Error();
    } catch { return { ok: false, error: 'inputs_invalid:video_url' }; }
    const prompt = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
    if (!prompt || inputs.prompt.length > 30000) return { ok: false, error: 'inputs_invalid:prompt' };
    return { ok: true, body: { model: SEEDANCE_25_MODEL, input: {
        prompt, reference_videos: [...videos], task_type: task, duration: task === 'edit' ? -1 : 5,
        aspect_ratio: 'auto', resolution: '720p', audio: true,
    } } };
}
