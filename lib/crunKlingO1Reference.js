// Kling O1 · Reference (`kling-o1-reference`) at Crun, as `feature_video`: the reference video supplies motion and look for a NEW
// clip, the requested length is used. Contract: docs.crun.ai/models/kling/o1-reference-to-video.json (read 2026-11-23).
// Paid proof 2026-11-23: task 681e4480-3036-44d8-84bb-30311e929b26, 5 s, 720p, 16:9, audio off, 90 credits, 364 s.
//
// Two facts from that proof shape the request:
//   - Kling refuses `aspect_ratio: auto` in feature mode ("Aspect ratio must be specified unless a first frame is provided or the
//     task is video editing"), so the gateway derives 1:1, 16:9 or 9:16 from the uploaded video's own size (withDerivedAspect).
//     fal's endpoint takes `auto` and follows any shape, so a 4:3 source is snapped to the nearest of the three on this route.
//   - Crun needs a prompt; fal treats it as optional, so a blank one gets DEFAULT_PROMPT here.
// OUR endpoint name `crun:kling/o1-r2v-ref` is not a Crun model id; the adapter sends Crun's `kling/o1-r2v`.
export const CRUN_KLING_O1_REFERENCE_ENDPOINT_MODEL = 'kling/o1-r2v-ref';
export const CRUN_KLING_O1_REFERENCE_ENDPOINT = `crun:${CRUN_KLING_O1_REFERENCE_ENDPOINT_MODEL}`;
export const CRUN_KLING_O1_REFERENCE_API_MODEL = 'kling/o1-r2v';
export const CRUN_KLING_O1_REFERENCE_ASPECTS = Object.freeze(['1:1', '16:9', '9:16']);
export const CRUN_KLING_O1_REFERENCE_PROMPT_MAX = 2500;
export const CRUN_KLING_O1_REFERENCE_DEFAULT_PROMPT = 'Create a new video that follows the motion and camera of the reference video, starring the people in the reference pictures.';

const DOCS = 'https://docs.crun.ai/models/kling/o1-reference-to-video.json';
const RATIO_VALUE = Object.freeze({ '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16 });
const SECONDS = new Set([5, 10]);
const ALLOWED = new Set(['prompt', 'duration_seconds', 'video_url', 'image_url', 'aspect_ratio']);
const list = value => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const isHttps = (value) => {
    try { return typeof value === 'string' && new URL(value).protocol === 'https:'; } catch { return false; }
};

/**
 * The nearest of 1:1, 16:9 and 9:16 to a width x height, measured on a log scale; null when the size is unusable.
 * A tie (4:3 sits exactly between 1:1 and 16:9) goes to the non-square shape, which crops less of a wide or tall source.
 */
export function nearestKlingAspect(width, height) {
    if (!(width > 0) || !(height > 0)) return null;
    const ratio = Math.log(width / height);
    const candidates = width >= height ? ['16:9', '1:1'] : ['9:16', '1:1'];
    return candidates.reduce((best, name) => (Math.abs(ratio - Math.log(RATIO_VALUE[name])) < Math.abs(ratio - Math.log(RATIO_VALUE[best])) - 1e-9 ? name : best));
}

/**
 * Same inputs plus the server-derived aspect ratio, for a record that asks for it. The client never supplies this key:
 * declaredInputs drops it (serverOnly) before this runs. Pure; the input object is not changed.
 */
export function withDerivedAspect(record, inputs, sources) {
    if (!record?.aspectFromVideo) return inputs;
    const video = [sources?.video_url].flat().find(Boolean);
    const aspect = nearestKlingAspect(video?.dimensions?.width, video?.dimensions?.height);
    return aspect ? { ...inputs, aspect_ratio: aspect } : inputs;
}

// The same media pins as fal's `fal-ai/kling-video/o1/video-to-video/reference` record: video 3 to 10 s, 720 to 2160 px a side,
// one to two reference pictures, lengths 5 and 10. Crun would take more pictures and smaller videos; a source either supplier
// would refuse is refused for both so the offer is one product.
export const CRUN_KLING_O1_REFERENCE_CAPABILITY = Object.freeze({
    provider: 'crun', kind: 'video', verifiedAt: '2026-11-23', verification: DOCS,
    aspectFromVideo: true,
    inputs: {
        prompt: { type: 'string', max: CRUN_KLING_O1_REFERENCE_PROMPT_MAX },
        aspect_ratio: { type: 'enum', values: [...CRUN_KLING_O1_REFERENCE_ASPECTS], serverOnly: true },
    },
    rename: {},
    media: {
        video: { field: 'reference_videos', required: true, minSeconds: 3, maxSeconds: 10, minSide: 720, maxSide: 2160, verifiedAt: '2026-11-23', verification: DOCS },
        image: { field: 'reference_images', required: true, list: true, max: 2, label: 'Reference pictures', verifiedAt: '2026-11-23', verification: DOCS, priceVerification: 'https://docs.crun.ai/common-api/estimate-task-credits.md' },
    },
    lengths: { field: 'duration', map: { 5: 5, 10: 10 } },
    fixed: { model: CRUN_KLING_O1_REFERENCE_API_MODEL, reference_video_type: 'feature_video', resolution: '720p', audio: false },
    assumes: {},
});

/**
 * Our @Video1 / @Image1 / @Image2 tags (the template Recreate recipe writes them for fal) as words Crun's model reads; Crun documents
 * no tag syntax. A recipe may name a second picture a caller did not send; that is harmless wording, so only a tag beyond the two
 * pictures this offer takes, or any other @ tag, is refused (null).
 */
export function referencesAsWords(prompt) {
    const ordinal = ['first', 'second'];
    let valid = true;
    const text = prompt
        .replace(/@video1\b/gi, 'the reference video')
        .replace(/@image(\d+)\b/gi, (_, digits) => {
            const n = Number(digits);
            if (n < 1 || n > ordinal.length) { valid = false; return ''; }
            return `the ${ordinal[n - 1]} reference picture`;
        });
    return valid && !/@(?:video|element|image)/i.test(text) ? text : null;
}

/** Crun CreateTask body for the feature-mode reference offer, or a typed refusal. Nothing is changed silently. */
export function buildKlingO1ReferenceRequest(inputs) {
    const extra = Object.keys(inputs).find(key => !ALLOWED.has(key));
    if (extra) return { ok: false, error: `inputs_key_not_allowed:${extra.slice(0, 32)}` };
    const videos = list(inputs.video_url), images = list(inputs.image_url);
    if (videos.length !== 1 || !videos.every(isHttps)) return { ok: false, error: 'inputs_invalid:video_url' };
    if (!images.length || !images.every(isHttps)) return { ok: false, error: 'inputs_invalid:image_url' };
    if (images.length > 2) return { ok: false, error: 'source_count_exceeded' };
    const seconds = inputs.duration_seconds === undefined ? 5 : inputs.duration_seconds;
    if (!SECONDS.has(seconds)) return { ok: false, error: 'duration_not_supported' };
    // The shape is derived by the gateway from the video's own size; none means that size could not be read.
    if (inputs.aspect_ratio === undefined) return { ok: false, error: 'source_size_unknown' };
    if (!CRUN_KLING_O1_REFERENCE_ASPECTS.includes(inputs.aspect_ratio)) return { ok: false, error: 'inputs_invalid:aspect_ratio' };
    const written = referencesAsWords(typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '');
    if (written === null || written.length > CRUN_KLING_O1_REFERENCE_PROMPT_MAX) return { ok: false, error: 'inputs_invalid:prompt' };
    return { ok: true, body: { model: CRUN_KLING_O1_REFERENCE_API_MODEL, input: {
        prompt: written || CRUN_KLING_O1_REFERENCE_DEFAULT_PROMPT, duration: seconds, resolution: '720p',
        reference_videos: [...videos], reference_video_type: 'feature_video', reference_images: [...images],
        aspect_ratio: inputs.aspect_ratio, audio: false,
    } } };
}
