// On-device photo looks. Each look is a 4x5 colour matrix (Skia's row-major layout,
// offsets in 0..1) so a change is drawn at once and costs nothing: no upload, no credits.
export const LOOK_IDS = ['original', 'clarity', 'glow', 'warm', 'cool', 'fade', 'vivid', 'soft', 'mono'] as const;
export type LookId = (typeof LOOK_IDS)[number];
export type Matrix = readonly number[];
export type Look = { readonly id: LookId; readonly strength: number };

export const IDENTITY: Matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
export const DEFAULT_STRENGTH = 0.8;

const LUMA = [0.2126, 0.7152, 0.0722] as const;
const saturation = (s: number): Matrix => {
    const [r, g, b] = LUMA;
    return [
        r + (1 - r) * s, g - g * s, b - b * s, 0, 0,
        r - r * s, g + (1 - g) * s, b - b * s, 0, 0,
        r - r * s, g - g * s, b + (1 - b) * s, 0, 0,
        0, 0, 0, 1, 0,
    ];
};
const contrast = (c: number): Matrix => {
    const o = (1 - c) / 2;
    return [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0];
};
const tone = (r: number, g: number, b: number, lift = 0): Matrix => [1, 0, 0, 0, r + lift, 0, 1, 0, 0, g + lift, 0, 0, 1, 0, b + lift, 0, 0, 0, 1, 0];
// Applies `first`, then `second`.
export function chain(first: Matrix, second: Matrix): Matrix {
    const out: number[] = [];
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 5; col++) {
            let value = 0;
            for (let k = 0; k < 4; k++) value += second[row * 5 + k] * first[k * 5 + col];
            if (col === 4) value += second[row * 5 + 4];
            out.push(value);
        }
    }
    return out;
}

const LOOKS: Readonly<Record<LookId, Matrix>> = {
    original: IDENTITY,
    clarity: chain(contrast(1.18), saturation(1.12)),
    glow: chain(saturation(1.08), tone(0.05, 0.03, 0.02, 0.03)),
    warm: chain(saturation(1.1), tone(0.07, 0.02, -0.06)),
    cool: chain(saturation(1.05), tone(-0.05, 0, 0.07)),
    fade: chain(contrast(0.82), tone(0.04, 0.04, 0.05, 0.04)),
    vivid: chain(contrast(1.1), saturation(1.55)),
    soft: chain(contrast(0.92), tone(0.03, 0.02, 0.02, 0.02)),
    mono: chain(saturation(0), contrast(1.1)),
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
export function lookMatrix(look: Look): number[] {
    const target = LOOKS[look.id] ?? IDENTITY;
    const s = look.id === 'original' ? 0 : clamp01(look.strength);
    return target.map((value, i) => IDENTITY[i] + (value - IDENTITY[i]) * s);
}
export const isUnchanged = (look: Look): boolean => look.id === 'original' || clamp01(look.strength) === 0;
