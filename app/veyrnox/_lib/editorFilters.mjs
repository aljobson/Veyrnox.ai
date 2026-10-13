import { FILTER_DEFAULTS } from './editorAnimation.mjs';
import { colourDefaults, HSL_CHANNELS } from './editorColour.mjs';
import { trackFor } from './editorSequence.mjs';
import { validateSequence } from './editorSequenceValidation.mjs';

const colourKeys = ['exposure', 'temperature', 'tint', 'shadows', 'highlights', 'gamma'];
const mix = (a, b, amount) => a + (b - a) * amount;
const freeze = value => {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
};
function look(id, name, category, description, filter = {}, colour = {}, hsl = {}) {
    const defaults = colourDefaults();
    return freeze({ id, name, category, description,
        filter: { ...FILTER_DEFAULTS, ...filter },
        colour: { ...defaults, ...colour, hsl: Object.fromEntries(HSL_CHANNELS.map(channel => [channel, { ...defaults.hsl[channel], ...hsl[channel] }])) },
    });
}
/** Original numerical grades, with no external media, LUTs or licensed catalog assets. */
export const FILTER_LOOKS = freeze([
    look('clean', 'Clean', 'Essentials', 'Neutral filter and colour values.'),
    look('soft-detail', 'Soft detail', 'Essentials', 'Gentler contrast and restrained highlights.', { contrast: .92, saturate: .94 }, { highlights: -.16, gamma: 1.06 }),
    look('bright-daylight', 'Bright daylight', 'Essentials', 'Brighter midtones with modest colour lift.', { brightness: 1.05, contrast: 1.05, saturate: 1.08 }, { exposure: .08, highlights: -.14 }),
    look('warm-film', 'Warm film', 'Cinema', 'Warm balance, deeper contrast and quieter colour.', { contrast: 1.12, saturate: .82 }, { temperature: .22, highlights: -.12, shadows: .04 }),
    look('cool-film', 'Cool film', 'Cinema', 'Cool balance and restrained cinematic contrast.', { contrast: 1.12, saturate: .86 }, { temperature: -.2, highlights: -.1 }),
    look('night-blue', 'Night blue', 'Cinema', 'Darker exposure with a cool night palette.', { brightness: .9, contrast: 1.14, saturate: .78 }, { exposure: -.25, temperature: -.25, shadows: -.06 }),
    look('faded-print', 'Faded print', 'Cinema', 'Lifted shadows and muted print colour.', { contrast: .88, saturate: .7 }, { shadows: .22, highlights: -.15, temperature: .1, gamma: 1.04 }),
    look('gentle-portrait', 'Gentle portrait', 'Portrait', 'Soft contrast with warm skin colour balance.', { contrast: .95, saturate: .96 }, { temperature: .09, tint: .035, highlights: -.15, shadows: .08 }),
    look('warm-portrait', 'Warm portrait', 'Portrait', 'Warmer mids with reduced orange saturation.', { contrast: 1.03, saturate: .98 }, { temperature: .16, highlights: -.1 }, { orange: { saturation: -.12, luminance: .08 } }),
    look('cool-portrait', 'Cool portrait', 'Portrait', 'Cool surroundings with softened blue colour.', { contrast: 1.02, saturate: .95 }, { temperature: -.12, highlights: -.12 }, { blue: { saturation: -.12 }, orange: { luminance: .06 } }),
    look('vivid-landscape', 'Vivid landscape', 'Landscape', 'Stronger landscape colour and contrast.', { contrast: 1.1, saturate: 1.25 }, { highlights: -.12, shadows: .07 }),
    look('forest', 'Forest', 'Landscape', 'Deeper greens with protected bright areas.', { contrast: 1.08, saturate: 1.08 }, { highlights: -.18, shadows: -.05 }, { green: { saturation: .16, luminance: -.1 }, yellow: { saturation: -.08 } }),
    look('coastal', 'Coastal', 'Landscape', 'Lifted shadows and richer blue/cyan colour.', { contrast: 1.03, saturate: 1.08 }, { temperature: -.08, shadows: .12, highlights: -.12 }, { cyan: { saturation: .12 }, blue: { saturation: .14, luminance: -.06 } }),
    look('mono', 'Monochrome', 'Monochrome', 'Colour removed with clear contrast.', { saturate: 0, contrast: 1.15 }),
    look('soft-mono', 'Soft monochrome', 'Monochrome', 'Colour removed with softer highlights.', { saturate: 0, contrast: .94 }, { highlights: -.14, shadows: .12 }),
    look('deep-mono', 'Deep monochrome', 'Monochrome', 'Colour removed with deeper blacks.', { saturate: 0, contrast: 1.35 }, { shadows: -.14, exposure: -.08 }),
]);
export const FILTER_CATEGORIES = freeze(['All', ...new Set(FILTER_LOOKS.map(item => item.category))]);
export function searchFilterLooks(query = '', category = 'All') {
    const words = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return FILTER_LOOKS.filter(item => (category === 'All' || item.category === category)
        && words.every(word => `${item.name} ${item.category} ${item.description}`.toLocaleLowerCase().includes(word)));
}
export function filterSelectionProblem(tl, selection) {
    if (!Array.isArray(selection) || !selection.length || selection.length > 40) return 'Select a video or image clip first.';
    if (selection.some(item => !item || item.track !== 'video' || typeof item.id !== 'string')) return 'Choose visual clips for a filter.';
    const ids = new Set(selection.map(item => item.id));
    if ([...ids].some(id => !tl.video.some(clip => clip.id === id))) return 'The selection changed. Select the visual clips again.';
    if (tl.video.some(clip => ids.has(clip.id) && trackFor(tl, clip)?.locked)) return 'Unlock every selected visual track first.';
    return null;
}
function blendClip(clip, preset, intensity) {
    const sourceFilter = { ...FILTER_DEFAULTS, ...clip.filter }, sourceColour = clip.colourAdjustment || colourDefaults();
    const filter = Object.fromEntries(Object.keys(FILTER_DEFAULTS).map(key => [key, mix(sourceFilter[key], preset.filter[key], intensity)]));
    const colourAdjustment = { ...sourceColour,
        ...Object.fromEntries(colourKeys.map(key => [key, mix(sourceColour[key], preset.colour[key], intensity)])),
        hsl: Object.fromEntries(HSL_CHANNELS.map(channel => [channel, Object.fromEntries(['hue', 'saturation', 'luminance'].map(key => [key, mix(sourceColour.hsl[channel][key], preset.colour.hsl[channel][key], intensity)]))])),
    };
    const parameterKeyframes = clip.parameterKeyframes?.map(key => ({ ...key,
        ...Object.fromEntries(Object.keys(FILTER_DEFAULTS).map(name => [name, mix(key[name], preset.filter[name], intensity)])),
        ...Object.fromEntries(['exposure', 'temperature', 'tint'].map(name => [name, mix(key[name], preset.colour[name], intensity)])),
    }));
    return { ...clip, filter, colourAdjustment, ...(parameterKeyframes ? { parameterKeyframes } : {}) };
}
/** One atomic edit; curves and all unrelated picture, sound, motion and timing fields survive. */
export function applyFilterLook(tl, selection, presetId, intensity = 1) {
    const invalid = validateSequence(tl) || filterSelectionProblem(tl, selection);
    if (invalid) return { error: invalid };
    const preset = FILTER_LOOKS.find(item => item.id === presetId);
    if (!preset) return { error: 'Choose an original look.' };
    if (typeof intensity !== 'number' || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) return { error: 'Choose a filter strength between 0% and 100%.' };
    if (intensity === 0) return tl;
    const ids = new Set(selection.map(item => item.id));
    const next = { ...tl, video: tl.video.map(clip => ids.has(clip.id) ? blendClip(clip, preset, intensity) : clip) };
    const problem = validateSequence(next);
    return problem ? { error: problem } : next;
}
export function resetFilterGrade(tl, selection) {
    const invalid = validateSequence(tl) || filterSelectionProblem(tl, selection);
    if (invalid) return { error: invalid };
    const ids = new Set(selection.map(item => item.id));
    const next = { ...tl, video: tl.video.map(clip => ids.has(clip.id) ? {
        ...clip, filter: { ...FILTER_DEFAULTS }, colourAdjustment: colourDefaults(),
        ...(clip.parameterKeyframes ? { parameterKeyframes: clip.parameterKeyframes.map(key => ({ ...key, ...FILTER_DEFAULTS, exposure: 0, temperature: 0, tint: 0 })) } : {}),
    } : clip) };
    const problem = validateSequence(next);
    return problem ? { error: problem } : next;
}
