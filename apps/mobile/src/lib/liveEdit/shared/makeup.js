/** Platform-neutral makeup descriptors. Colours are pigment data, not UI theme tokens. */
const bounded = n => Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
export const SHADES = Object.freeze({
    rose: '#ad385c', coral: '#d96b58', berry: '#772c54', nude: '#b77e70',
    plum: '#65416f', bronze: '#99633f', champagne: '#dbc099', cocoa: '#51382d',
    ink: '#211d26', porcelain: '#e7bd9e', sand: '#b88460', deep: '#704633',
});
export const MAKEUP = Object.freeze([
    { id: 'foundation', region: 'skin', blend: 'soft-light', shades: ['porcelain', 'sand', 'deep'] },
    { id: 'blush', region: 'cheeks', blend: 'soft-light', shades: ['rose', 'coral', 'berry'] },
    { id: 'eyeshadow', region: 'lids', blend: 'multiply', shades: ['plum', 'bronze', 'champagne'] },
    { id: 'brows', region: 'brows', blend: 'multiply', shades: ['cocoa', 'ink', 'bronze'] },
    { id: 'eyeliner', region: 'upperEyes', blend: 'multiply', shades: ['ink', 'cocoa', 'plum'] },
    { id: 'lashes', region: 'upperEyes', blend: 'multiply', shades: ['ink', 'cocoa'] },
    { id: 'lips', region: 'lips', blend: 'multiply', shades: ['rose', 'coral', 'berry', 'nude'] },
].map(d => Object.freeze({ ...d, shades: Object.freeze(d.shades), defaultStrength: 0, face: true })));
export const MAKEUP_DEFAULTS = Object.freeze(Object.fromEntries(MAKEUP.map(d => [d.id, Object.freeze({
    strength: 0, shade: d.shades[0], ...(d.id === 'lips' ? { finish: 'matte' } : {}),
    ...(d.id === 'eyeshadow' ? { shade2: 'champagne' } : {}),
    ...(d.id === 'eyeliner' ? { wing: .4 } : {}), ...(d.id === 'lashes' ? { volume: .5 } : {}),
})])));
export function normalizeMakeup(input = {}) {
    return Object.fromEntries(MAKEUP.map(d => {
        const value = input?.[d.id] ?? {}, fallback = MAKEUP_DEFAULTS[d.id];
        return [d.id, { ...fallback, strength: bounded(value.strength), shade: d.shades.includes(value.shade) ? value.shade : fallback.shade,
            ...(d.id === 'lips' ? { finish: ['matte', 'gloss', 'tint'].includes(value.finish) ? value.finish : 'matte' } : {}),
            ...(d.id === 'eyeshadow' ? { shade2: d.shades.includes(value.shade2) ? value.shade2 : fallback.shade2 } : {}),
            ...(d.id === 'eyeliner' ? { wing: bounded(value.wing ?? fallback.wing) } : {}),
            ...(d.id === 'lashes' ? { volume: bounded(value.volume ?? fallback.volume) } : {}),
        }];
    }));
}
export const MAKEUP_PRESETS = Object.freeze({
    natural: normalizeMakeup({ lips: { strength: .3, shade: 'nude', finish: 'tint' }, blush: { strength: .2, shade: 'coral' }, brows: { strength: .2 }, foundation: { strength: .15, shade: 'sand' } }),
    glam: normalizeMakeup({ lips: { strength: .7, shade: 'rose', finish: 'gloss' }, blush: { strength: .4 }, eyeshadow: { strength: .65, shade: 'plum', shade2: 'champagne' }, eyeliner: { strength: .85, wing: .8 }, lashes: { strength: .8, volume: .85 }, brows: { strength: .4 } }),
    boldLip: normalizeMakeup({ lips: { strength: .9, shade: 'berry', finish: 'matte' }, brows: { strength: .25 } }),
});
export const rgb = shade => SHADES[shade].slice(1).match(/../g).map(c => parseInt(c, 16) / 255);
/** CPU reference only. Renderer implements these blend equations in GLSL. */
export function blendChannel(base, pigment, mode) {
    if (mode === 'multiply') return base * pigment;
    if (mode === 'screen') return base + pigment - base * pigment;
    const d = base <= .25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
    return pigment <= .5 ? base - (1 - 2 * pigment) * base * (1 - base) : base + (2 * pigment - 1) * (d - base);
}
export function blendColor(base, pigment, mode, strength) {
    const amount = bounded(strength);
    return base.map((b, i) => b + (blendChannel(b, pigment[i], mode) - b) * amount);
}
