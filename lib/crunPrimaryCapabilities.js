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
