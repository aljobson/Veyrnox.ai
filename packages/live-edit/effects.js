import { HAIR_DEFAULTS, normalizeHair } from './hair.js';
import { MAKEUP_DEFAULTS, normalizeMakeup } from './makeup.js';
import { lookMatrix, IDENTITY, LOOK_IDS, chain } from './looks.js';
export { LOOK_IDS };
export const clamp = (n, min = 0, max = 1) => Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
export const EFFECTS = Object.freeze([
    ['brightness', -1, 1], ['contrast', -1, 1], ['saturation', -1, 1],
    ['warmth', -1, 1], ['tint', -1, 1], ['vignette', 0, 1], ['grain', 0, 1],
    ['smoothing', 0, 1], ['blemish', 0, 1], ['teeth', 0, 1], ['eyes', 0, 1],
].map(([id, min, max]) => Object.freeze({ id, min, max, step: 0.01, defaultStrength: 0, face: ['smoothing', 'blemish', 'teeth', 'eyes'].includes(id) })));
export const DEFAULTS = Object.freeze({ ...Object.fromEntries(EFFECTS.map(e => [e.id, 0])), look: 'original', strength: 0.8, lut: 'none', lutStrength: 0, stickers: [], hair: HAIR_DEFAULTS, makeup: MAKEUP_DEFAULTS });
export function normalize(settings = {}) {
    return { hair: normalizeHair(settings.hair), makeup: normalizeMakeup(settings.makeup), ...Object.fromEntries(EFFECTS.map(e => [e.id, clamp(Number.isFinite(settings[e.id]) ? settings[e.id] : 0, e.min, e.max)])),
        look: LOOK_IDS.includes(settings.look) ? settings.look : 'original', strength: clamp(settings.strength ?? 0.8),
        lut: ['none', 'film', 'print'].includes(settings.lut) ? settings.lut : 'none', lutStrength: clamp(settings.lutStrength ?? 0),
        stickers: (settings.stickers ?? []).slice(0, 8).filter(s => ['spark', 'heart', 'flower'].includes(s.kind)).map(s => ({ kind: s.kind, x: clamp(s.x), y: clamp(s.y), size: clamp(s.size, 0.02, 0.3) })),
    };
}
export function colorMatrix(settings) {
    const s = normalize(settings), c = 1 + s.contrast, sat = 1 + s.saturation;
    const luma = [0.2126, 0.7152, 0.0722];
    const m = IDENTITY.slice();
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) m[row * 5 + col] = c * (luma[col] * (1 - sat) + (row === col ? sat : 0));
        m[row * 5 + 4] = (1 - c) / 2 + s.brightness * 0.5 + [s.warmth * 0.12, s.tint * 0.12, -s.warmth * 0.12][row];
    }
    return chain(lookMatrix({ id: s.look, strength: s.strength }), m);
}
/** Original RGB tone curves, sampled as a 256-entry texture, not third-party LUTs. */
export function toneLut(kind) {
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
        const x = i / 255;
        const y = kind === 'film' ? x * x * (3 - 2 * x) : kind === 'print' ? 0.04 + 0.92 * Math.pow(x, 0.9) : x;
        for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(clamp(y + (kind === 'film' ? [0.025, 0, -0.025][c] * 4 * x * (1 - x) : 0)) * 255);
        data[i * 4 + 3] = 255;
    }
    return data;
}
export function createHistory(initial = DEFAULTS) {
    let past = [], present = normalize(initial), future = [];
    return {
        get value() { return structuredClone(present); },
        get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
        set(next) { const value = normalize(next); if (JSON.stringify(value) === JSON.stringify(present)) return; past = [...past.slice(-99), present]; present = value; future = []; },
        undo() { if (past.length) { future.push(present); present = past.pop(); } },
        redo() { if (future.length) { past.push(present); present = future.pop(); } },
    };
}
