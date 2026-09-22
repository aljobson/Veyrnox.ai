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
 *   provider   'fal' | 'kie' | 'openrouter' | 'veyrnox' (our own pipeline)
 *   kind       'image' | 'video' | 'audio' | 'speech'
 *   inputs     our field -> rule. Rule types: string {max, required},
 *              enum {values}, int {min,max}. Only these keys may be sent.
 *   rename     our field -> provider field (default: same name)
 *   media      slot -> { field, required, list, maxPixels, maxSeconds }:
 *              reference URLs the model accepts; `list` sends the URL as a
 *              one-item array; `maxPixels` / `maxSeconds` refuse a larger or
 *              longer upload before the debit
 *   derive     optional (inputs, sources) -> fields computed per request from
 *              the source's pixel size (see expandCanvas); `derives` names
 *              them for the live-schema check
 *   lengths    null (one fixed unit) or { field, map: { ourSeconds: providerValue } }
 *   fixed      provider field -> value, sent on every request, applied last
 *   assumes    provider field -> default the price relies on but we do not
 *              send; the live-schema check fails if the provider changes it
 */

import { parseDialogue } from './dialogue.js';

export const UNIT_SECONDS = 5;

const PROMPT = { type: 'string', max: 2000, required: true };
// Speech bills per character, so its price covers this many and no more.
const SPEECH_TEXT = { type: 'string', max: 1000, required: true };
const NEGATIVE = { type: 'string', max: 2000 };
const SEED = { type: 'int', min: 0, max: 2147483647 };
const aspects = (...values) => ({ type: 'enum', values });
const NB_PRO_ASPECTS = aspects('auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16');

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
    // $0.05 per 1000 characters: the 1000-character cap bounds it at $0.05.
    'fal-ai/elevenlabs/tts/turbo-v2.5': {
        provider: 'fal', kind: 'speech',
        inputs: { prompt: SPEECH_TEXT },
        rename: { prompt: 'text' },
        media: {}, lengths: null,
        fixed: { timestamps: false },
        assumes: {},
    },
    // $0.10 per 1000 characters: capped at $0.10. The default output is hex
    // in the JSON body, so the audio URL is pinned.
    'fal-ai/minimax/speech-2.6-hd': {
        provider: 'fal', kind: 'speech',
        inputs: { prompt: SPEECH_TEXT },
        rename: {},
        media: {}, lengths: null,
        fixed: { output_format: 'url' },
        assumes: {},
    },
    // $0.001/s: one 8s clip = $0.008.
    'fal-ai/mmaudio-v2/text-to-audio': {
        provider: 'fal', kind: 'audio',
        inputs: { prompt: PROMPT, negative_prompt: NEGATIVE, seed: SEED },
        rename: {},
        media: {}, lengths: null,
        fixed: { duration: 8, num_steps: 25 },
        assumes: {},
    },
    // $0.04 per image on the model page ($0.018 in its billing field; the
    // higher figure is priced). No prompt: the whole input is the image.
    'fal-ai/bria/background/remove': {
        provider: 'fal', kind: 'image',
        inputs: {},
        rename: {},
        media: { image: { field: 'image_url', required: true } },
        lengths: null,
        fixed: { sync_mode: false },
        assumes: {},
    },
    // Billed by output size: $0.08 up to 24 MP. Pinned at 2x, so a source of
    // at most 6 MP stays in that tier.
    'fal-ai/topaz/upscale/image': {
        provider: 'fal', kind: 'image',
        inputs: {},
        rename: {},
        media: { image: { field: 'image_url', required: true, maxPixels: 6_000_000 } },
        lengths: null,
        fixed: { upscale_factor: 2, model: 'Standard V2', output_format: 'jpeg', crop_to_fill: false },
        assumes: {},
    },
    // $0.04 per generation at any size. The canvas it expands into is worked
    // out from the source's pixel size and the chosen aspect ratio.
    'fal-ai/bria/expand': {
        provider: 'fal', kind: 'image',
        inputs: { prompt: { type: 'string', max: 2000 }, negative_prompt: NEGATIVE, seed: SEED,
            aspect_ratio: aspects('16:9', '9:16', '1:1', '4:3', '3:4', '4:5') },
        rename: {},
        media: { image: { field: 'image_url', required: true, maxPixels: 25_000_000 } },
        lengths: null,
        fixed: { sync_mode: false },
        assumes: {},
        derive: (inputs, sources) => ({ canvas_size: expandCanvas(sources.image_url.dimensions, inputs.aspect_ratio || '16:9') }),
        derives: ['canvas_size'],
    },
    // $0.20 flat for output up to 40s; the output follows the audio. Both
    // sources are capped at 40s so no request reaches the per-second rate.
    'fal-ai/latentsync': {
        provider: 'fal', kind: 'video',
        inputs: { seed: SEED },
        rename: {},
        media: {
            video: { field: 'video_url', required: true, maxSeconds: 40 },
            audio: { field: 'audio_url', required: true, maxSeconds: 40 },
        },
        lengths: null,
        fixed: {},
        assumes: {},
    },
    // $0.0562 per output second; the output is as long as the audio, which
    // is capped at 10s: $0.562.
    'fal-ai/kling-video/ai-avatar/v2/standard': {
        provider: 'fal', kind: 'video',
        inputs: { prompt: { type: 'string', max: 2000 } },
        rename: {},
        media: {
            image: { field: 'image_url', required: true },
            audio: { field: 'audio_url', required: true, maxSeconds: 10 },
        },
        lengths: null,
        fixed: {},
        assumes: {},
    },
    // $0.10 per 1000 characters; the script is capped at 1000: $0.10. The
    // prompt is a "Name: line" script, turned into speaker blocks.
    'fal-ai/elevenlabs/text-to-dialogue/eleven-v3': {
        provider: 'fal', kind: 'speech',
        inputs: { prompt: SPEECH_TEXT, seed: SEED },
        rename: { prompt: null },
        media: {}, lengths: null,
        fixed: {},
        assumes: {},
        validate: (inputs) => (parseDialogue(inputs.prompt).ok ? { ok: true } : { ok: false, error: 'dialogue_invalid' }),
        derive: (inputs) => ({ inputs: parseDialogue(inputs.prompt).blocks }),
        derives: ['inputs'],
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
    // $0.15 per image at 1K or 2K; 4K and web search cost extra, so both are
    // pinned. sync_mode stays off: we need the webhook, not a data URI.
    'fal-ai/nano-banana-pro': {
        provider: 'fal', kind: 'image',
        inputs: { prompt: PROMPT, seed: SEED, aspect_ratio: NB_PRO_ASPECTS },
        rename: {},
        media: {}, lengths: null,
        fixed: { resolution: '2K', num_images: 1, enable_web_search: false, sync_mode: false },
        assumes: {},
    },
    // Same price as text-to-image. One reference image, sent as a one-item
    // image_urls list. Inactive until the create page can upload a source.
    'fal-ai/nano-banana-pro/edit': {
        provider: 'fal', kind: 'image',
        inputs: { prompt: PROMPT, seed: SEED, aspect_ratio: NB_PRO_ASPECTS },
        rename: {},
        media: { image: { field: 'image_urls', required: true, list: true } },
        lengths: null,
        fixed: { resolution: '2K', num_images: 1, enable_web_search: false, sync_mode: false },
        assumes: {},
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

// Bria refuses a canvas of 5000x5000 pixels or more in area.
const EXPAND_MAX_AREA = 5000 * 5000 - 1;
const EXPAND_MARGIN = 1.25;

/**
 * Canvas for Bria expand: the smallest one of the chosen aspect ratio that
 * holds the source, grown by a quarter so there is always new area to fill,
 * then scaled down to Bria's area limit.
 */
export function expandCanvas({ width, height }, aspect) {
    const [a, b] = String(aspect).split(':').map(Number);
    const ratio = a / b;
    let w = width / height < ratio ? height * ratio : width;
    let h = width / height < ratio ? height : width / ratio;
    w *= EXPAND_MARGIN;
    h *= EXPAND_MARGIN;
    const shrink = Math.min(1, Math.sqrt(EXPAND_MAX_AREA / (w * h)));
    return [Math.floor(w * shrink), Math.floor(h * shrink)];
}

/**
 * Pre-debit check of the uploaded sources against the model's slots: a slot
 * with `maxPixels` or `maxSeconds` needs a readable size or length at or
 * under it.
 * @param {Record<string, {dimensions:object|null, seconds:number|null}>} sources
 *        keyed by input field (image_url, audio_url, ...)
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function checkSource(record, sources) {
    for (const [slot, spec] of Object.entries((record && record.media) || {})) {
        const source = sources && sources[mediaKey(slot)];
        if (!source) continue;
        if (spec.maxPixels) {
            const d = source.dimensions;
            if (!d) return { ok: false, error: 'source_size_unknown' };
            if (d.width * d.height > spec.maxPixels) return { ok: false, error: 'source_too_large' };
        }
        if (spec.maxSeconds) {
            if (!Number.isFinite(source.seconds)) return { ok: false, error: 'source_length_unknown' };
            if (source.seconds > spec.maxSeconds) return { ok: false, error: 'source_too_long' };
        }
    }
    return { ok: true };
}

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
        if (rule.type === 'string' && rule.max && String(value).length > rule.max) return { ok: false, error: `inputs_invalid:${key}` };
    }
    for (const [key, rule] of Object.entries(record.inputs)) {
        if (rule.required && !(inputs && typeof inputs[key] === 'string' && inputs[key].trim())) {
            return { ok: false, error: `inputs_invalid:${key}` };
        }
    }
    for (const [slot, spec] of Object.entries(record.media)) {
        if (spec.required && !(inputs && inputs[mediaKey(slot)])) return { ok: false, error: `inputs_invalid:${mediaKey(slot)}` };
    }
    return record.validate ? record.validate(inputs || {}) : { ok: true };
}

/**
 * Provider payload for a fal record: declared inputs renamed, media URLs in
 * their fields, our length mapped, pinned values last. Assumes checkInputs
 * passed. kie and OpenRouter keep their adapters' builders until step 2.
 */
export function shapePayload(record, inputs, sources = null) {
    const out = {};
    for (const key of Object.keys(record.inputs)) {
        // A rename to null consumes the input: `derive` turns it into fields.
        if (inputs[key] !== undefined && record.rename[key] !== null) out[has(record.rename, key) ? record.rename[key] : key] = inputs[key];
    }
    for (const [slot, spec] of Object.entries(record.media)) {
        const url = inputs[mediaKey(slot)];
        if (url !== undefined) out[spec.field] = spec.list ? [url] : url;
    }
    if (record.lengths) out[record.lengths.field] = record.lengths.map[inputs.duration_seconds || UNIT_SECONDS];
    const derived = record.derive ? record.derive(inputs, sources || {}) : {};
    return { ...out, ...derived, ...record.fixed };
}

/** Client-safe view for /api/catalog: no provider fields, pins or assumptions. */
export function publicCapabilities(record) {
    if (!record) return null;
    const inputs = {};
    for (const [key, rule] of Object.entries(record.inputs)) {
        inputs[key] = rule.type === 'enum' ? { type: 'enum', values: [...rule.values] } : { type: rule.type };
    }
    const media = {};
    for (const [slot, spec] of Object.entries(record.media)) {
        media[slot] = { required: !!spec.required };
        if (spec.maxPixels) media[slot].maxPixels = spec.maxPixels;
        if (spec.maxSeconds) media[slot].maxSeconds = spec.maxSeconds;
    }
    return { kind: record.kind, lengths: lengthsFor(record), inputs, media };
}
