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

/**
 * Rewrite validated inputs into the provider payload: our `duration_seconds`
 * becomes whatever field the endpoint family uses, and nothing else of ours
 * crosses over.
 */
export function shapeForProvider(modelRow, inputs) {
    const { duration_seconds: seconds, ...rest } = inputs;
    const spec = durationSpec(modelRow);
    if (spec && seconds) rest[spec.field] = spec.values[seconds];
    return rest;
}
