import { helperEnglish } from '../../../lib/helperMessages.mjs';
// Original effect names and recipes. These do not include third-party presets or assets.
export const VIDEO_EFFECTS = Object.freeze([
    { id: 'none', name: 'None', category: 'Basic', description: helperEnglish('remove_the_clip_effect') },
    { id: 'vignette', name: 'Vignette', category: 'Basic', description: helperEnglish('darken_the_frame_edges') },
    { id: 'pixelate', name: 'Pixelate', category: 'Basic', description: helperEnglish('create_a_blocky_lowresolution_look') },
    { id: 'grain', name: 'Film grain', category: 'Basic', description: helperEnglish('add_animated_fine_grain') },
    { id: 'soft-glow', name: 'Soft glow', category: 'Light', description: helperEnglish('bloom_highlights_over_the_source') },
    { id: 'light-leak', name: 'Light leak', category: 'Light', description: helperEnglish('sweep_a_warm_light_flare_across_the_frame') },
    { id: 'pulse', name: 'Exposure pulse', category: 'Light', description: helperEnglish('pulse_the_exposure_with_the_clip_time') },
    { id: 'strobe', name: 'Strobe', category: 'Light', description: helperEnglish('flash_the_picture_at_a_bounded_rate') },
    { id: 'old-film', name: 'Old film', category: 'Retro', description: helperEnglish('warm_the_picture_with_grain_flicker_and_scratches') },
    { id: 'scanlines', name: 'Scanlines', category: 'Retro', description: helperEnglish('add_animated_display_scanlines') },
    { id: 'mono', name: 'Monochrome', category: 'Retro', description: helperEnglish('blend_the_picture_toward_black_and_white') },
    { id: 'sepia', name: 'Sepia', category: 'Retro', description: helperEnglish('blend_in_a_warm_archival_tone') },
    { id: 'chromatic', name: 'Chromatic shift', category: 'Glitch', description: helperEnglish('offset_red_and_cyan_image_channels') },
    { id: 'negative', name: 'Negative', category: 'Glitch', description: helperEnglish('invert_the_source_colours') },
    { id: 'mirror', name: 'Mirror split', category: 'Glitch', description: helperEnglish('reflect_half_the_frame') },
    { id: 'tiles', name: 'Motion tiles', category: 'Glitch', description: helperEnglish('repeat_the_picture_in_a_moving_tile_grid') },
    { id: 'duotone', name: 'Duotone', category: 'Style', description: helperEnglish('map_the_picture_into_teal_and_violet_light') },
    { id: 'posterize', name: 'Posterize', category: 'Style', description: helperEnglish('reduce_the_picture_to_bold_colour_bands') },
]);

export const EFFECT_TYPES = Object.freeze(VIDEO_EFFECTS.map(effect => effect.id));
export const EFFECT_CATEGORIES = Object.freeze(['All', ...new Set(VIDEO_EFFECTS.map(effect => effect.category))]);

export const TRANSITIONS = Object.freeze([
    { id: 'dissolve', name: 'Dissolve', category: 'Blend' },
    { id: 'dip-black', name: 'Dip to black', category: 'Blend' },
    { id: 'flash', name: 'Flash', category: 'Blend' },
    { id: 'blur', name: 'Blur dissolve', category: 'Blend' },
    { id: 'wipe-left', name: 'Wipe left', category: 'Wipe' },
    { id: 'wipe-right', name: 'Wipe right', category: 'Wipe' },
    { id: 'wipe-up', name: 'Wipe up', category: 'Wipe' },
    { id: 'wipe-down', name: 'Wipe down', category: 'Wipe' },
    { id: 'slide-left', name: 'Slide left', category: 'Move' },
    { id: 'slide-right', name: 'Slide right', category: 'Move' },
    { id: 'slide-up', name: 'Slide up', category: 'Move' },
    { id: 'slide-down', name: 'Slide down', category: 'Move' },
    { id: 'zoom', name: 'Zoom', category: 'Move' },
    { id: 'iris-open', name: 'Iris open', category: 'Shape' },
    { id: 'iris-close', name: 'Iris close', category: 'Shape' },
    { id: 'clock-wipe', name: 'Clock wipe', category: 'Shape' },
    { id: 'barn-doors', name: 'Barn doors', category: 'Shape' },
    { id: 'blinds', name: 'Blinds', category: 'Shape' },
    { id: 'pixel-dissolve', name: 'Pixel dissolve', category: 'Shape' },
    { id: 'push', name: 'Push', category: 'Move' },
    { id: 'spin', name: 'Spin in', category: 'Move' },
    { id: 'whip-pan', name: 'Whip pan', category: 'Move' },
    { id: 'cross-zoom', name: 'Cross zoom', category: 'Move' },
    { id: 'glitch', name: 'Glitch', category: 'Style' },
    { id: 'light-leak', name: 'Light leak', category: 'Style' },
]);

// `slide` remains readable for projects saved before directional slides were introduced.
export const TRANSITION_TYPES = Object.freeze([...TRANSITIONS.map(transition => transition.id), 'slide']);
export const TRANSITION_CATEGORIES = Object.freeze(['All', ...new Set(TRANSITIONS.map(transition => transition.category))]);
