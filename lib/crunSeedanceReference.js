// Seedance 2.0 reference-to-video at Crun (docs.crun.ai/models/seedance/2-0/reference-to-video.json, read 2026-11-22).
// STAGED: no catalog row or route names this endpoint until a paid audio-on proof exists (ADR-0256 amendment 2026-11-22).
export const SEEDANCE_R2V_MODEL = 'bytedance/seedance2-0-r2v';

const PROMPT_MAX = 30000;
const MAX_IMAGES = 9;
const SECONDS = new Set([5, 10]);
const ASPECTS = new Set(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
const RESOLUTIONS = new Set(['720p', '1080p', '4k']);
const ALLOWED = new Set(['prompt', 'aspect_ratio', 'duration_seconds', 'resolution', 'image_url', 'video_url']);

const list = value => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const isHttps = (value) => {
    try { return typeof value === 'string' && new URL(value).protocol === 'https:'; } catch { return false; }
};

/** Our @Image1 / @Video1 tags as Crun's [Image1] / [Video1]; null when a tag names a file the request does not carry. */
export function crunReferenceTags(prompt, imageCount, videoCount) {
    let valid = true;
    const text = prompt.replace(/@(image|video)(\d+)\b/gi, (_, kind, digits) => {
        const number = Number(digits);
        const isImage = kind.toLowerCase() === 'image';
        if (number < 1 || number > (isImage ? imageCount : videoCount)) valid = false;
        return `[${isImage ? 'Image' : 'Video'}${number}]`;
    });
    return valid ? text : null;
}

export function buildSeedanceReferenceRequest(inputs) {
    const extra = Object.keys(inputs).find(key => !ALLOWED.has(key));
    if (extra) return { ok: false, error: `inputs_key_not_allowed:${extra.slice(0, 32)}` };
    const images = list(inputs.image_url), videos = list(inputs.video_url);
    if (!images.length || !images.every(isHttps)) return { ok: false, error: 'inputs_invalid:image_url' };
    if (images.length > MAX_IMAGES || videos.length > 1) return { ok: false, error: 'source_count_exceeded' };
    if (!videos.every(isHttps)) return { ok: false, error: 'inputs_invalid:video_url' };
    const source = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
    if (!source || source.length > PROMPT_MAX) return { ok: false, error: 'inputs_invalid:prompt' };
    const prompt = crunReferenceTags(source, images.length, videos.length);
    if (prompt === null || prompt.length > PROMPT_MAX) return { ok: false, error: 'inputs_invalid:prompt' };
    const duration = inputs.duration_seconds ?? 5;
    if (!SECONDS.has(duration)) return { ok: false, error: 'duration_not_supported' };
    const aspect = inputs.aspect_ratio ?? 'auto';
    if (!ASPECTS.has(aspect)) return { ok: false, error: 'inputs_invalid:aspect_ratio' };
    const resolution = inputs.resolution ?? '720p';
    if (!RESOLUTIONS.has(resolution)) return { ok: false, error: 'resolution_not_supported' };
    // A reference video bills input plus output seconds; at 1080p a 10 s source on a 5 s clip costs more than the floor allows.
    if (videos.length && resolution !== '720p') return { ok: false, error: 'resolution_not_supported' };
    return { ok: true, body: { model: SEEDANCE_R2V_MODEL, input: {
        prompt, reference_images: [...images], ...(videos.length ? { reference_videos: [...videos] } : {}),
        resolution, aspect_ratio: aspect, duration, audio: true,
    } } };
}
