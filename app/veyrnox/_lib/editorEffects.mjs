// Original effect names and recipes. These do not include third-party presets or assets.
export const VIDEO_EFFECTS = Object.freeze([
    { id: 'none', name: 'None', category: 'Basic', description: 'Remove the clip effect.' },
    { id: 'vignette', name: 'Vignette', category: 'Basic', description: 'Darken the frame edges.' },
    { id: 'pixelate', name: 'Pixelate', category: 'Basic', description: 'Create a blocky low-resolution look.' },
    { id: 'grain', name: 'Film grain', category: 'Basic', description: 'Add animated fine grain.' },
    { id: 'soft-glow', name: 'Soft glow', category: 'Light', description: 'Bloom highlights over the source.' },
    { id: 'light-leak', name: 'Light leak', category: 'Light', description: 'Sweep a warm light flare across the frame.' },
    { id: 'pulse', name: 'Exposure pulse', category: 'Light', description: 'Pulse the exposure with the clip time.' },
    { id: 'strobe', name: 'Strobe', category: 'Light', description: 'Flash the picture at a bounded rate.' },
    { id: 'old-film', name: 'Old film', category: 'Retro', description: 'Warm the picture with grain, flicker and scratches.' },
    { id: 'scanlines', name: 'Scanlines', category: 'Retro', description: 'Add animated display scanlines.' },
    { id: 'mono', name: 'Monochrome', category: 'Retro', description: 'Blend the picture toward black and white.' },
    { id: 'sepia', name: 'Sepia', category: 'Retro', description: 'Blend in a warm archival tone.' },
    { id: 'chromatic', name: 'Chromatic shift', category: 'Glitch', description: 'Offset red and cyan image channels.' },
    { id: 'negative', name: 'Negative', category: 'Glitch', description: 'Invert the source colours.' },
    { id: 'mirror', name: 'Mirror split', category: 'Glitch', description: 'Reflect half the frame.' },
    { id: 'tiles', name: 'Motion tiles', category: 'Glitch', description: 'Repeat the picture in a moving tile grid.' },
    { id: 'duotone', name: 'Duotone', category: 'Style', description: 'Map the picture into teal and violet light.' },
    { id: 'posterize', name: 'Posterize', category: 'Style', description: 'Reduce the picture to bold colour bands.' },
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
]);

// `slide` remains readable for projects saved before directional slides were introduced.
export const TRANSITION_TYPES = Object.freeze([...TRANSITIONS.map(transition => transition.id), 'slide']);
export const TRANSITION_CATEGORIES = Object.freeze(['All', ...new Set(TRANSITIONS.map(transition => transition.category))]);
