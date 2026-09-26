// Non-fal capabilities. Kept separate so the registry stays under 500 lines.
const PROMPT = { type: 'string', max: 2000, required: true };
const SPEECH_TEXT = { type: 'string', max: 1000, required: true };
const SEED = { type: 'int', min: 0, max: 2147483647 };
const aspects = (...values) => ({ type: 'enum', values });
const NB_PRO_ASPECTS = aspects('auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16');

// kie and OpenRouter records describe what their adapters already build
// (packages/adapters/kie.js, openrouter.js). Step 2 moves the adapters onto them.
const VEO_KIE = {
    provider: 'kie', kind: 'video',
    inputs: { prompt: PROMPT, aspect_ratio: aspects('16:9', '9:16') },
    rename: {},
    media: { image: { field: 'imageUrls' } },
    lengths: null,
    fixed: { resolution: '720p', duration: 8, enableTranslation: false },
    assumes: {},
};

// BytePlus ModelArk Seedance rows (ADR-0058): one 5s 720p clip per priced
// unit, text or first-frame image in, no video input, no extension or edit.
// ModelArk bills by output token, so resolution and duration are the price:
// both are pinned here and the adapter turns prompt + image_url into the
// `content` array. `service_tier` default and audio-on for 2.x are the
// PAYG/pack prices the rows carry; the live-schema check watches them.
const BYTEPLUS_ASPECTS = aspects('16:9', '9:16', '1:1', '4:3', '3:4');
const byteplusVideo = (model, { audio = true } = {}) => ({
    provider: 'byteplus', kind: 'video',
    inputs: { prompt: PROMPT, aspect_ratio: BYTEPLUS_ASPECTS },
    rename: { aspect_ratio: 'ratio' },
    // Optional first frame: 4K-ish cap keeps the upload within ModelArk's
    // image limits without forcing the client to downscale a phone photo.
    media: { image: { field: 'image_url', maxPixels: 4096 * 4096 } },
    lengths: { field: 'duration', map: { 5: 5 } },
    fixed: { model, resolution: '720p', watermark: false },
    assumes: audio ? { service_tier: 'default', generate_audio: true } : { service_tier: 'default' },
});

export const OTHERS = {
    'byteplus:seedance-2.0-fast': byteplusVideo('dreamina-seedance-2-0-fast-260128'),
    'byteplus:seedance-2.0-mini': byteplusVideo('dreamina-seedance-2-0-mini-260615'),
    'byteplus:seedance-2.0': byteplusVideo('dreamina-seedance-2-0-260128'),
    'byteplus:seedance-2.5': byteplusVideo('dreamina-seedance-2-5-260628'),
    'byteplus:seedance-1.0-pro-fast': byteplusVideo('seedance-1-0-pro-fast-251015', { audio: false }),
    // Verified 2026-09-24: one 2K image, 1800 GrsAI credits. Polling only.
    'grsai:nano-banana-pro': {
        provider: 'grsai', kind: 'image',
        inputs: { prompt: PROMPT, aspect_ratio: NB_PRO_ASPECTS },
        rename: { aspect_ratio: 'aspectRatio' },
        media: {}, lengths: null,
        fixed: { model: 'nano-banana-pro', imageSize: '2K', webHook: '-1', shutProgress: true },
        assumes: {},
    },
    // Auto Short (ADR-0029): our own pipeline, one priced unit = one 32s video.
    // The orchestrator (lib/autoShort.js) makes the provider calls.
    'auto-short:v1': {
        provider: 'veyrnox', kind: 'video',
        inputs: { topic: { type: 'string', max: 200, required: true } },
        rename: {},
        media: {}, lengths: null,
        fixed: {},
        assumes: {},
    },
    // Clip Editor (docs/editor/PRD.md): trims, joins and scores the caller's
    // own videos. `clips`/`audio` are structured; lib/clipEditSources.js
    // checks their shape, ownership and real lengths, and the price comes
    // from the edit's output length, not from these inputs.
    'clip-edit:v1': {
        provider: 'veyrnox', kind: 'video', edit: true,
        inputs: { clips: { type: 'edit' }, audio: { type: 'edit' } },
        rename: {},
        media: {}, lengths: null,
        fixed: {},
        assumes: {},
    },
    'veo:veo3_lite': VEO_KIE,
    'veo:veo3_fast': VEO_KIE,
    'veo:veo3': VEO_KIE,
    'market:google/nano-banana': {
        provider: 'kie', kind: 'image',
        inputs: { prompt: PROMPT, aspect_ratio: aspects('1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9') },
        rename: {},
        media: {}, lengths: null,
        fixed: { output_format: 'png' },
        assumes: {},
    },
    // kie twins of the fal rows (2026-09-24). Prompt caps are kie's own: 800 for
    // Wan, 1000 for Kling, 10000 for Nano Banana Pro (we keep 2000). Negative
    // prompt and seed are not offered here, so the gateway drops them.
    'market:wan/2-5-text-to-video': {
        provider: 'kie', kind: 'video',
        inputs: { prompt: { type: 'string', max: 800, required: true }, aspect_ratio: aspects('16:9', '9:16', '1:1') },
        rename: {},
        media: {},
        lengths: { field: 'duration', map: { 5: '5', 10: '10' } },
        fixed: { resolution: '720p' },
        assumes: {},
    },
    'market:kling-2.6/text-to-video': {
        provider: 'kie', kind: 'video',
        inputs: { prompt: { type: 'string', max: 1000, required: true }, aspect_ratio: aspects('16:9', '9:16', '1:1') },
        rename: {},
        media: {},
        lengths: { field: 'duration', map: { 5: '5', 10: '10' } },
        fixed: { sound: false },
        assumes: {},
    },
    // Hailuo 02 Standard: kie's 6s 768p clip ($0.15). Only our 5s unit is sold.
    // kie documents no resolution field for this endpoint, so 768p is kie's
    // default and the $0.15 price relies on it: confirm the charge on the live run.
    'market:hailuo/02-text-to-video-standard': {
        provider: 'kie', kind: 'video',
        inputs: { prompt: { type: 'string', max: 1500, required: true } },
        rename: {},
        media: {},
        lengths: { field: 'duration', map: { 5: '6' } },
        fixed: { nsfw_checker: true },
        assumes: {},
    },
    // Seedream 4.5 at the basic (2K) tier; the 4K 'high' tier is never sent.
    'market:seedream/4.5-text-to-image': {
        provider: 'kie', kind: 'image',
        inputs: { prompt: PROMPT, aspect_ratio: aspects('1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9') },
        rename: {},
        media: {}, lengths: null,
        fixed: { quality: 'basic', nsfw_checker: true },
        assumes: {},
    },
    // $0.03 per 1000 characters: the 1000-character cap bounds it. Voice pinned
    // to fal's default so the provider swap is not audible.
    'market:elevenlabs/text-to-speech-turbo-2-5': {
        provider: 'kie', kind: 'speech',
        inputs: { prompt: SPEECH_TEXT },
        rename: { prompt: 'text' },
        media: {}, lengths: null,
        fixed: { voice: 'Rachel', timestamps: false },
        assumes: {},
    },
    'market:nano-banana-pro': {
        provider: 'kie', kind: 'image',
        inputs: { prompt: PROMPT, aspect_ratio: NB_PRO_ASPECTS },
        rename: {},
        media: {}, lengths: null,
        fixed: { resolution: '2K', output_format: 'png' },
        assumes: {},
    },
    'bytedance/seedance-2.0-fast': {
        provider: 'openrouter', kind: 'video',
        inputs: { prompt: PROMPT, seed: SEED, aspect_ratio: aspects('16:9', '9:16') },
        rename: {},
        media: { image: { field: 'frame_images' } },
        lengths: { field: 'duration', map: { 5: 5, 10: 10 } },
        fixed: { resolution: '720p', generate_audio: true },
        assumes: {},
    },
};
