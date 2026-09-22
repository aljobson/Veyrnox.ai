/**
 * Which clip lengths a fal endpoint can actually be asked for, and how to
 * ask.
 *
 * `duration_seconds` is our field, not fal's. Each endpoint family names it
 * differently, and a family we have no mapping for runs at its own default
 * length no matter what we send — so selling a 10-second clip there would
 * bill double for five seconds of video.
 *
 * Server-side only. `provider_endpoint` is not exposed to the browser
 * (0022_lock_model_catalog_from_anon), so the client cannot work this out
 * for itself: GET /api/catalog publishes the resulting `durations` list and
 * the create page renders only those.
 *
 * ponytail: two families known; extend from each endpoint's OpenAPI as
 * models land. The default is the cautious one — an unmapped endpoint sells
 * 5 seconds only.
 */

export const UNIT_SECONDS = 5;

const DURATION_FIELDS = [
    { prefix: 'fal-ai/wan', field: 'duration', values: { 5: '5', 10: '10' } },
    { prefix: 'fal-ai/kling-video', field: 'duration', values: { 5: '5', 10: '10' } },
    // Hailuo 02 makes 6s or 10s clips, never 5s; our 5s unit buys its 6s
    // clip ($0.045/s = $0.27). 10s is not sold.
    { prefix: 'fal-ai/minimax/hailuo-02', field: 'duration', values: { 5: '6' } },
];

/** @returns {{prefix:string, field:string, values:object}|null} */
export function durationSpec(modelRow) {
    const ep = String((modelRow && modelRow.provider_endpoint) || '');
    if (!ep) return null;
    return DURATION_FIELDS.find((d) => ep === d.prefix || ep.startsWith(d.prefix + '/') || ep.startsWith(d.prefix + '-')) || null;
}

/**
 * The clip lengths this model may be sold at, shortest first. Non-video
 * models are a single output and always [5]; the create page hides the
 * control when there is nothing to choose between.
 * @returns {number[]}
 */
export function durationsFor(modelRow) {
    const modality = String((modelRow && modelRow.modality) || '');
    if (!modality.includes('video')) return [UNIT_SECONDS];
    const spec = durationSpec(modelRow);
    if (!spec) return [UNIT_SECONDS];
    return Object.keys(spec.values).map(Number).sort((a, b) => a - b);
}

// Endpoints whose payload differs from our field names. `keep` is what may
// cross over, `rename` maps our field to theirs, `fixed` pins the billed
// quantity to the unit the catalog row is priced at (prices from each fal
// model page, 2026-09-12).
const VEO_SHAPE = {
    keep: ['prompt', 'negative_prompt', 'seed', 'aspect_ratio'],
    rename: {},
    aspects: ['16:9', '9:16'],
    fixed: { duration: '4s', resolution: '720p', generate_audio: true },
};

// Pass-through endpoints whose fal defaults are not the priced tier. Checked
// against each endpoint's live OpenAPI schema and pricing on 2026-09-22:
//   wan-25-preview defaults to 1080p ($0.15/s); the row is priced at 720p.
//   kling v2.6 pro defaults to audio on ($0.14/s); priced at audio off.
// `pins` are sent on every request after the length mapping; `aspects` is
// the provider's own aspect-ratio enum, checked before the debit.
const DEFAULT_PINS = {
    'fal-ai/wan-25-preview/text-to-video': { pins: { resolution: '720p' }, aspects: ['16:9', '9:16', '1:1'] },
    'fal-ai/kling-video/v2.6/pro/text-to-video': { pins: { generate_audio: false }, aspects: ['16:9', '9:16', '1:1'] },
};

const PAYLOAD_SHAPES = {
    // Requires `tags`, not `prompt`. $0.0002/s: one 60s track = $0.012.
    'fal-ai/ace-step': { keep: ['prompt', 'seed'], rename: { prompt: 'tags' }, fixed: { duration: 60 } },
    // $0.0003/s, 2x with thinking: one 60s track with thinking = $0.036.
    'fal-ai/ace-step-1.5': { keep: ['prompt', 'seed'], rename: {}, fixed: { duration: 60, thinking: true, num_outputs: 1 } },
    // $0.002/s: one 10s effect = $0.02.
    'fal-ai/elevenlabs/sound-effects/v2': { keep: ['prompt'], rename: { prompt: 'text' }, fixed: { duration_seconds: 10 } },
    // $0.01 per 1000 chars: the 2000-char prompt cap bounds it at $0.02.
    'fal-ai/inworld-tts': { keep: ['prompt'], rename: { prompt: 'text' }, fixed: {} },
    // fal defaults Veo 3.1 to 8s; pin 4s 720p with audio. $0.15/s = $0.60 (Fast),
    // $0.40/s = $1.60 (standard). Only 16:9 and 9:16 exist on these endpoints.
    'fal-ai/veo3.1/fast': VEO_SHAPE,
    'fal-ai/veo3.1': VEO_SHAPE,
};

/**
 * Pre-debit check that the inputs fit the endpoint's payload shape. An aspect
 * ratio the endpoint cannot make would otherwise debit and then refund.
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function payloadCheck(modelRow, inputs) {
    const ep = String((modelRow && modelRow.provider_endpoint) || '');
    const shape = Object.prototype.hasOwnProperty.call(PAYLOAD_SHAPES, ep) ? PAYLOAD_SHAPES[ep]
        : Object.prototype.hasOwnProperty.call(DEFAULT_PINS, ep) ? DEFAULT_PINS[ep] : null;
    if (shape && shape.aspects && inputs.aspect_ratio && !shape.aspects.includes(inputs.aspect_ratio)) {
        return { ok: false, error: 'inputs_invalid:aspect_ratio' };
    }
    // A length the endpoint family cannot be asked for would run at the
    // provider's default while the debit counted the requested units.
    const spec = durationSpec(modelRow);
    if (spec && inputs.duration_seconds && !Object.prototype.hasOwnProperty.call(spec.values, inputs.duration_seconds)) {
        return { ok: false, error: 'duration_not_supported' };
    }
    return { ok: true };
}

/**
 * Rewrite validated inputs into the provider payload: our `duration_seconds`
 * becomes whatever field the endpoint family uses, and nothing else of ours
 * crosses over.
 */
export function shapeForProvider(modelRow, inputs) {
    const { duration_seconds: seconds, ...rest } = inputs;
    const ep = String((modelRow && modelRow.provider_endpoint) || '');
    const shape = Object.prototype.hasOwnProperty.call(PAYLOAD_SHAPES, ep) ? PAYLOAD_SHAPES[ep] : null;
    if (shape) {
        const out = {};
        for (const key of shape.keep) {
            if (rest[key] !== undefined) out[shape.rename[key] || key] = rest[key];
        }
        return { ...out, ...shape.fixed };
    }
    const spec = durationSpec(modelRow);
    if (spec) rest[spec.field] = spec.values[seconds || UNIT_SECONDS];
    const pinned = Object.prototype.hasOwnProperty.call(DEFAULT_PINS, ep) ? DEFAULT_PINS[ep].pins : {};
    return { ...rest, ...pinned };
}
