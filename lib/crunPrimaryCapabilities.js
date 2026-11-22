// Crun as first route for FLUX.2 Pro and Kling Avatar (ADR-0256 amendment 2026-11-22, migration 0581).
// Contracts read 2026-11-22: docs.crun.ai/models/flux/flux-2-pro.json and /models/kling/avatar.json.
// The adapter (packages/adapters/crun.js) enforces the same limits, because Crun's provider check does not run checkInputs.
const FLUX_VERIFICATION = 'https://docs.crun.ai/models/flux/flux-2-pro.json';
const AVATAR_VERIFICATION = 'https://docs.crun.ai/models/kling/avatar.json';

export const CRUN_FLUX_2_PRO_PROMPT_MAX = 5000;
export const CRUN_KLING_AVATAR_PROMPT_MAX = 2500;
export const CRUN_FLUX_2_PRO_ASPECTS = Object.freeze(['1:1', '4:3', '3:4', '16:9', '9:16']);

// The same five shapes, seed and 4:3 default as the fal record. Crun's own default ratio is not 4:3, so it is always sent.
export const CRUN_FLUX_2_PRO_CAPABILITY = Object.freeze({
    provider: 'crun', kind: 'image', verifiedAt: '2026-11-22', verification: FLUX_VERIFICATION,
    inputs: {
        prompt: { type: 'string', max: CRUN_FLUX_2_PRO_PROMPT_MAX, required: true },
        seed: { type: 'int', min: 0, max: 2147483647 },
        aspect_ratio: { type: 'enum', values: [...CRUN_FLUX_2_PRO_ASPECTS] },
    },
    rename: {}, media: {}, lengths: null,
    defaults: { aspect_ratio: '4:3' },
    fixed: { model: 'flux-2-pro', resolution: '1K', output_format: 'png' },
    assumes: {},
});

// STAGED, on no route: audio-on is unproved. Same prices and shapes as the fal record; sound stays on as sold.
export const CRUN_SEEDANCE_REFERENCE_CAPABILITY = Object.freeze({
    provider: 'crun', kind: 'video', verifiedAt: '2026-11-22', verification: 'https://docs.crun.ai/models/seedance/2-0/reference-to-video.json',
    inputs: { prompt: { type: 'string', max: 30000, required: true }, aspect_ratio: { type: 'enum', values: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] } },
    rename: {},
    media: {
        image: { field: 'reference_images', required: true, list: true, max: 9, label: 'Reference pictures', verifiedAt: '2026-11-22', verification: 'https://docs.crun.ai/models/seedance/2-0/reference-to-video.json', priceVerification: 'https://crun.ai/pricing', minSide: 300, maxSide: 6000, minAspect: 0.4, maxAspect: 2.5, maxBytesExclusive: 30_000_000 },
        video: { field: 'reference_videos', required: false, list: true, max: 1, serverOnly: true, minSeconds: 2, maxSeconds: 10, minSide: 300, maxSide: 2160, minPixels: 409600, minAspect: 0.4, maxAspect: 2.5, minFrameRate: 24, maxFrameRate: 60, maxBytesExclusive: 200_000_001 },
    },
    lengths: { field: 'duration', map: { 5: 5, 10: 10 } },
    fixed: { model: 'bytedance/seedance2-0-r2v', resolution: '720p', audio: true, generate_audio: true },
    tiers: { base: '720p', options: { '1080p': { resolution: '1080p' }, '4k': { resolution: '4k' } }, multipliers: { '1080p': 2.25, '4k': 5.15 } },
    assumes: {},
});

// Crun documents JPEG/PNG photos up to 10 MB, 300 px or more, ratio 0.4 to 2.5, and audio of 2 to 300 s up to 5 MB.
// Uploads outside that are refused before the debit. The 10 s audio cap is what bounds the cost: 6.5 credits a second.
export const CRUN_KLING_AVATAR_CAPABILITY = Object.freeze({
    provider: 'crun', kind: 'video', verifiedAt: '2026-11-22', verification: AVATAR_VERIFICATION,
    inputs: { prompt: { type: 'string', max: CRUN_KLING_AVATAR_PROMPT_MAX } },
    rename: {},
    media: {
        image: { field: 'image_url', required: true, contentTypes: ['image/jpeg', 'image/png'], minSide: 300, minAspect: 0.4, maxAspect: 2.5, maxBytesExclusive: 10_000_001 },
        audio: { field: 'audio_url', required: true, contentTypes: ['audio/mpeg', 'audio/wav'], minAudioSeconds: 2, maxSeconds: 10, maxBytesExclusive: 5_000_001 },
    },
    lengths: null,
    fixed: { model: 'kling/avatar', mode: 'std' },
    assumes: {},
});
