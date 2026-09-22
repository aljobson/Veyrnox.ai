/**
 * Model capability registry — step 1 of docs/model-capability-registry/SPEC.md.
 *
 * One record per catalog `provider_endpoint`: what inputs the model takes (in
 * our field names), which provider fields they land in, which clip lengths a
 * priced unit can buy, and which values are pinned so the request always
 * matches what the catalog row is costed at.
 *
 * The generations gateway and /api/catalog read it (ADR-0027). A catalog row
 * with no record cannot be listed or bought. tests/modelCapabilities.test.mjs
 * pins the payloads against tests/fixtures/capability-payloads.json (captured
 * from the pre-registry builder), and scripts/check-capabilities.mjs checks
 * every fal record against fal's live OpenAPI schema.
 *
 * Design ported from Open Generative AI's modelCapabilities.js and
 * videoModelParameters.js (MIT, (c) 2026 Open Generative AI Contributors):
 * per-model input schema, media slots, pinned parameters. Their MuAPI catalog
 * is not used.
 *
 * Record fields
 *   provider   'fal' | 'kie' | 'openrouter'
 *   kind       'image' | 'video' | 'audio' | 'speech'
 *   inputs     our field -> rule. Rule types: string {max, required},
 *              enum {values}, int {min,max}. Only these keys may be sent.
 *   rename     our field -> provider field (default: same name)
 *   media      slot -> { field, required }: reference URLs the model accepts
 *   lengths    null (one fixed unit) or { field, map: { ourSeconds: providerValue } }
 *   fixed      provider field -> value, sent on every request, applied last
 *   assumes    provider field -> default the price relies on but we do not
 *              send; the live-schema check fails if the provider changes it
 */

export const UNIT_SECONDS = 5;

const PROMPT = { type: 'string', max: 2000, required: true };
const NEGATIVE = { type: 'string', max: 2000 };
const SEED = { type: 'int', min: 0, max: 2147483647 };
const aspects = (...values) => ({ type: 'enum', values });

// fal records: schemas and prices read from fal on 2026-09-22.
const FAL = {
    // $0.0002/s: one 60s track = $0.012. Requires `tags`, not `prompt`.
    'fal-ai/ace-step': {
        provider: 'fal', kind: 'audio',
        inputs: { prompt: PROMPT, seed: SEED },
        rename: { prompt: 'tags' },
        media: {}, lengths: null,
        fixed: { duration: 60 },
        assumes: {},
    },
    // $0.0003/s, 2x with thinking: one 60s track = $0.036.
    'fal-ai/ace-step-1.5': {
        provider: 'fal', kind: 'audio',
        inputs: { prompt: PROMPT, seed: SEED },
        rename: {},
        media: {}, lengths: null,
        fixed: { duration: 60, thinking: true, num_outputs: 1 },
        assumes: {},
    },
    // $0.002/s: one 10s effect = $0.02.
    'fal-ai/elevenlabs/sound-effects/v2': {
        provider: 'fal', kind: 'audio',
        inputs: { prompt: PROMPT },
        rename: { prompt: 'text' },
        media: {}, lengths: null,
        fixed: { duration_seconds: 10 },
        assumes: {},
    },
    // $0.01 per 1000 chars: the 2000-char prompt cap bounds it at $0.02.
    'fal-ai/inworld-tts': {
        provider: 'fal', kind: 'speech',
        inputs: { prompt: PROMPT },
        rename: { prompt: 'text' },
        media: {}, lengths: null,
        fixed: {},
        assumes: {},
    },
    // $0.03 for the first megapixel; landscape_4_3 (1024x768) is under one.
    'fal-ai/flux-2-pro': {
        provider: 'fal', kind: 'image',
        inputs: { prompt: PROMPT, seed: SEED },
        rename: {},
        media: {}, lengths: null,
        fixed: {},
        assumes: { image_size: 'landscape_4_3' },
    },
    // $0.03 per image at any size, one image per request.
    'fal-ai/bytedance/seedream/v4/text-to-image': {
        provider: 'fal', kind: 'image',
        inputs: { prompt: PROMPT, seed: SEED },
        rename: {},
        media: {}, lengths: null,
        fixed: {},
        assumes: { num_images: 1, max_images: 1, image_size: { height: 2048, width: 2048 } },
    },
    // $0.039 per image (inactive row).
    'fal-ai/nano-banana': {
        provider: 'fal', kind: 'image',
        inputs: { prompt: PROMPT, seed: SEED,
            aspect_ratio: aspects('21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16') },
        rename: {},
        media: {}, lengths: null,
        fixed: {},
        assumes: { num_images: 1 },
    },
    // $0.07/s audio off ($0.14/s on): pin audio off.
    'fal-ai/kling-video/v2.6/pro/text-to-video': {
        provider: 'fal', kind: 'video',
        inputs: { prompt: PROMPT, negative_prompt: NEGATIVE, aspect_ratio: aspects('16:9', '9:16', '1:1') },
        rename: {},
        media: {},
        lengths: { field: 'duration', map: { 5: '5', 10: '10' } },
        fixed: { generate_audio: false },
        assumes: {},
    },
    // Only 6s or 10s exist; our 5s unit buys the 6s clip ($0.045/s = $0.27).
    'fal-ai/minimax/hailuo-02/standard/text-to-video': {
        provider: 'fal', kind: 'video',
        inputs: { prompt: PROMPT },
        rename: {},
        media: {},
        lengths: { field: 'duration', map: { 5: '6' } },
        fixed: {},
        assumes: {},
    },
    // $0.10/s at 720p (1080p default is $0.15/s): pin 720p.
    'fal-ai/wan-25-preview/text-to-video': {
        provider: 'fal', kind: 'video',
        inputs: { prompt: PROMPT, negative_prompt: NEGATIVE, seed: SEED, aspect_ratio: aspects('16:9', '9:16', '1:1') },
        rename: {},
        media: {},
        lengths: { field: 'duration', map: { 5: '5', 10: '10' } },
        fixed: { resolution: '720p' },
        assumes: {},
    },
    // Defaults to 8s; the 5s unit buys a 4s 720p clip with audio.
    'fal-ai/veo3.1/fast': {
        provider: 'fal', kind: 'video',
        inputs: { prompt: PROMPT, negative_prompt: NEGATIVE, seed: SEED, aspect_ratio: aspects('16:9', '9:16') },
        rename: {},
        media: {}, lengths: null,
        fixed: { duration: '4s', resolution: '720p', generate_audio: true },
        assumes: {},
    },
    'fal-ai/veo3.1': {
        provider: 'fal', kind: 'video',
        inputs: { prompt: PROMPT, negative_prompt: NEGATIVE, seed: SEED, aspect_ratio: aspects('16:9', '9:16') },
        rename: {},
        media: {}, lengths: null,
        fixed: { duration: '4s', resolution: '720p', generate_audio: true },
        assumes: {},
    },
    // Inactive (0081). The correct contract: the start frame is
    // `start_image_url` (required), audio defaults on ($0.168/s vs $0.112/s).
    // Reactivate only after a live image-to-video test through the gateway.
    'fal-ai/kling-video/v3/pro/image-to-video': {
        provider: 'fal', kind: 'video',
        inputs: { prompt: { type: 'string', max: 2000 }, negative_prompt: NEGATIVE },
        rename: {},
        media: { image: { field: 'start_image_url', required: true }, endImage: { field: 'end_image_url' } },
        lengths: { field: 'duration', map: { 5: '5', 10: '10' } },
        fixed: { generate_audio: false },
        assumes: {},
    },
};

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

const OTHERS = {
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

export const REGISTRY = Object.freeze({ ...FAL, ...OTHERS });

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The record for a catalog row's endpoint, or null (unknown = not sellable). */
export function capabilityFor(providerEndpoint) {
    const ep = String(providerEndpoint || '');
    return has(REGISTRY, ep) ? REGISTRY[ep] : null;
}

/** Clip lengths (our seconds) one request may buy, shortest first. */
export function lengthsFor(record) {
    if (!record || record.kind !== 'video' || !record.lengths) return [UNIT_SECONDS];
    return Object.keys(record.lengths.map).map(Number).sort((a, b) => a - b);
}

/** Our input key for a media slot ('image' -> 'image_url'). */
const mediaKey = (slot) => (slot === 'image' ? 'image_url' : `${slot}_url`);

/**
 * The subset of `inputs` this model declares. The create page sends one
 * control set for every model (an aspect ratio for audio, say); keys a model
 * does not take are dropped here, so they are neither forwarded, stored on the
 * job, nor able to change what the request costs.
 */
export function declaredInputs(record, inputs) {
    const out = {};
    for (const [key, value] of Object.entries(inputs || {})) {
        if (key === 'duration_seconds' || has(record.inputs, key)) { out[key] = value; continue; }
        if (Object.keys(record.media).some((slot) => mediaKey(slot) === key)) out[key] = value;
    }
    return out;
}

/**
 * Pre-debit check of gateway-validated inputs against one model. Error codes
 * match the gateway's existing ones.
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function checkInputs(record, inputs) {
    if (!record) return { ok: false, error: 'provider_unsupported' };
    const mediaKeys = new Set(Object.keys(record.media).map(mediaKey));
    for (const [key, value] of Object.entries(inputs || {})) {
        if (key === 'duration_seconds') {
            if (!lengthsFor(record).includes(value)) return { ok: false, error: 'duration_not_supported' };
            continue;
        }
        if (mediaKeys.has(key)) continue;
        const rule = has(record.inputs, key) ? record.inputs[key] : null;
        if (!rule) return { ok: false, error: `inputs_key_not_allowed:${key.slice(0, 32)}` };
        if (rule.type === 'enum' && !rule.values.includes(value)) return { ok: false, error: `inputs_invalid:${key}` };
    }
    for (const [key, rule] of Object.entries(record.inputs)) {
        if (rule.required && !(inputs && typeof inputs[key] === 'string' && inputs[key].trim())) {
            return { ok: false, error: `inputs_invalid:${key}` };
        }
    }
    for (const [slot, spec] of Object.entries(record.media)) {
        if (spec.required && !(inputs && inputs[mediaKey(slot)])) return { ok: false, error: `inputs_invalid:${mediaKey(slot)}` };
    }
    return { ok: true };
}

/**
 * Provider payload for a fal record: declared inputs renamed, media URLs in
 * their fields, our length mapped, pinned values last. Assumes checkInputs
 * passed. kie and OpenRouter keep their adapters' builders until step 2.
 */
export function shapePayload(record, inputs) {
    const out = {};
    for (const key of Object.keys(record.inputs)) {
        if (inputs[key] !== undefined) out[has(record.rename, key) ? record.rename[key] : key] = inputs[key];
    }
    for (const [slot, spec] of Object.entries(record.media)) {
        if (inputs[mediaKey(slot)] !== undefined) out[spec.field] = inputs[mediaKey(slot)];
    }
    if (record.lengths) out[record.lengths.field] = record.lengths.map[inputs.duration_seconds || UNIT_SECONDS];
    return { ...out, ...record.fixed };
}

/** Client-safe view for /api/catalog: no provider fields, pins or assumptions. */
export function publicCapabilities(record) {
    if (!record) return null;
    const inputs = {};
    for (const [key, rule] of Object.entries(record.inputs)) {
        inputs[key] = rule.type === 'enum' ? { type: 'enum', values: [...rule.values] } : { type: rule.type };
    }
    const media = {};
    for (const [slot, spec] of Object.entries(record.media)) media[slot] = { required: !!spec.required };
    return { kind: record.kind, lengths: lengthsFor(record), inputs, media };
}
