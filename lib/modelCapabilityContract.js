import { effectiveMaxFiles } from './multiReference.mjs';
import { mediaInputKey as mediaKey } from './generationSourceSlots.mjs';
const UNIT_SECONDS = 5;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Clip lengths (our seconds) one request may buy, shortest first. */
export function lengthsFor(record) {
    if (!record || record.kind !== 'video' || !record.lengths) return [UNIT_SECONDS];
    return Object.keys(record.lengths.map).map(Number).sort((a, b) => a - b);
}


/**
 * The subset of `inputs` this model declares. The create page sends one
 * control set for every model (an aspect ratio for audio, say); keys a model
 * does not take are dropped here, so they are neither forwarded, stored on the
 * job, nor able to change what the request costs. Server-only media is dropped
 * unless admission has already resolved a trusted manifest and explicitly opts in.
 */
export function declaredInputs(record, inputs, { serverMedia = false } = {}) {
    const out = {};
    const supplied = inputs && typeof inputs === 'object' ? inputs : {};
    const declaredKeys = new Set([
        'duration_seconds',
        ...Object.keys(record.inputs || {}),
        ...Object.entries(record.media || {}).filter(([, spec]) => serverMedia || !spec.serverOnly).map(([slot]) => mediaKey(slot)),
    ]);
    // Iterate the trusted registry allowlist, never attacker-controlled keys.
    for (const key of declaredKeys) {
        if (has(supplied, key)) out[key] = supplied[key];
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
        if (rule.type === 'int' && (!Number.isInteger(value) || (Number.isFinite(rule.min) && value < rule.min)
            || (Number.isFinite(rule.max) && value > rule.max))) return { ok: false, error: `inputs_invalid:${key}` };
        if (rule.type === 'string' && rule.max && String(value).length > rule.max) return { ok: false, error: `inputs_invalid:${key}` };
    }
    for (const [key, rule] of Object.entries(record.inputs)) {
        if (rule.required && !(inputs && typeof inputs[key] === 'string' && inputs[key].trim())) {
            return { ok: false, error: `inputs_invalid:${key}` };
        }
    }
    for (const [slot, spec] of Object.entries(record.media)) {
        const urls = inputs?.[mediaKey(slot)];
        if (Array.isArray(urls) && (urls.length > effectiveMaxFiles(spec) || !urls.length || urls.some(url => typeof url !== 'string'))) return { ok: false, error: 'source_count_exceeded' };
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
        if (url !== undefined) out[spec.field] = spec.list ? (Array.isArray(url) ? [...url] : [url]) : (Array.isArray(url) ? url[0] : url);
    }
    if (record.lengths) out[record.lengths.field] = record.lengths.map[inputs.duration_seconds || UNIT_SECONDS];
    const derived = record.derive ? record.derive(inputs, sources || {}) : {};
    return { ...record.defaults, ...out, ...derived, ...record.fixed };
}

function resolutionPresentation(record) {
    const value = record?.fixed?.resolution ?? record?.defaults?.resolution ?? record?.fixed?.imageSize ?? record?.assumes?.resolution ?? record?.assumes?.imageSize;
    if (typeof value === 'string' && value.trim()) return value.trim();
    const size = record?.fixed?.image_size ?? record?.assumes?.image_size;
    if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) return `${size.width}×${size.height}`;
    return null;
}

// A customer-facing summary of the output contract that the one catalog price buys. It deliberately renames provider pins: the
// public catalog says "720p, audio on" without exposing request field names or allowing a more expensive tier to be requested.
function outputPresentation(record) {
    const presentation = {};
    const resolutionLabel = resolutionPresentation(record);
    if (resolutionLabel) presentation.resolutionLabel = resolutionLabel;
    const audio = record?.fixed?.generate_audio ?? record?.defaults?.generate_audio ?? record?.fixed?.sound ?? record?.assumes?.generate_audio ?? record?.assumes?.sound;
    if (typeof audio === 'boolean') presentation.audioIncluded = audio;
    if (record?.lengths?.map) presentation.durationByOption = Object.fromEntries(
        Object.entries(record.lengths.map).map(([priced, actual]) => [priced, String(actual).replace(/s$/i, '')]),
    );
    if (!record?.lengths) {
        const duration = record?.fixed?.duration ?? record?.fixed?.duration_seconds;
        if ((typeof duration === 'number' && duration > 0) || (typeof duration === 'string' && duration.trim())) {
            presentation.fixedDurationLabel = `${String(duration).replace(/s$/i, '')}s`;
        }
    }
    return presentation;
}

/** Client-safe view for /api/catalog: no provider field names, editable pins or assumptions. */
export function publicCapabilities(record) {
    if (!record) return null;
    const inputs = {};
    for (const [key, rule] of Object.entries(record.inputs)) {
        inputs[key] = rule.type === 'enum' ? { type: 'enum', values: [...rule.values] } : { type: rule.type };
        if (Number.isFinite(rule.min)) inputs[key].min = rule.min;
        if (Number.isFinite(rule.max)) inputs[key].max = rule.max;
        if (Number.isFinite(rule.default)) inputs[key].default = rule.default;
    }
    const media = {};
    for (const [slot, spec] of Object.entries(record.media)) {
        if (spec.serverOnly) continue;
        media[slot] = { required: !!spec.required, maxFiles: effectiveMaxFiles(spec) };
        if (spec.kind) media[slot].kind = spec.kind;
        if (spec.label) media[slot].label = spec.label;
        if (spec.maxPixels) media[slot].maxPixels = spec.maxPixels;
        if (spec.maxSeconds) media[slot].maxSeconds = spec.maxSeconds;
        if (spec.minSeconds) media[slot].minSeconds = spec.minSeconds;
        if (spec.minSide) media[slot].minSide = spec.minSide;
        if (spec.maxSide) media[slot].maxSide = spec.maxSide;
    }
    const presentation = outputPresentation(record);
    return {
        kind: record.kind,
        lengths: lengthsFor(record),
        inputs,
        media,
        ...(Object.keys(presentation).length ? { presentation } : {}),
        ...(record.outputStems ? { outputStems: record.outputStems } : {}),
    };
}
