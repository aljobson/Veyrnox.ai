import { OVAL } from './regions.js';
/** Pigment data, not interface colours. Linear-light luminance/chroma separation. */
export const HAIR_SHADES = Object.freeze({ copper: '#bf623e', plum: '#85458e', teal: '#287f89', blonde: '#d5b676' });
export const HAIR_DEFAULTS = Object.freeze({ strength: 0, shade: 'copper', shade2: 'blonde', mode: 'solid' });
export const HAIR_PRESETS = Object.freeze({
    copperGlow: Object.freeze({ ...HAIR_DEFAULTS, strength: .7 }),
    goldenOmbre: Object.freeze({ ...HAIR_DEFAULTS, strength: .8, mode: 'ombre' }),
    plumLights: Object.freeze({ ...HAIR_DEFAULTS, strength: .8, shade: 'plum', mode: 'highlights' }),
});
const clamp = n => Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
export function normalizeHair(value = {}) {
    return { strength: clamp(value.strength ?? 0), shade: Object.hasOwn(HAIR_SHADES, value.shade) ? value.shade : 'copper',
        shade2: Object.hasOwn(HAIR_SHADES, value.shade2) ? value.shade2 : 'blonde', mode: ['solid', 'ombre', 'highlights'].includes(value.mode) ? value.mode : 'solid' };
}
export const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t); };
// ADR-0092's 0.2–0.8 confidence matte, applied to hair rather than 1-background.
export const hairCoverage = confidence => smooth(.2, .8, confidence);
export const toLinear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
export const toSrgb = v => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;
export const luminance = rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
export const hairRgb = shade => [1, 3, 5].map(i => parseInt(HAIR_SHADES[shade].slice(i, i + 2), 16) / 255);
/** CPU reference only. Shader is qualified separately through the actual renderer. */
export function recolourHair(rgb, confidence, settings, position = .5) {
    const s = normalizeHair(settings), alpha = hairCoverage(confidence) * s.strength;
    if (alpha === 0) return rgb.slice();
    const base = rgb.map(toLinear), y = luminance(base);
    const first = hairRgb(s.shade).map(toLinear), second = hairRgb(s.shade2).map(toLinear);
    const gradient = s.mode === 'ombre' ? smooth(.25, .85, position) : 0;
    const pigment = first.map((v, i) => v + (second[i] - v) * gradient), py = luminance(pigment);
    const chroma = pigment.map(v => v - py);
    // Contract chroma into gamut instead of clipping channels (which changes luminance).
    const gamut = Math.min(1, ...chroma.map(v => v > 0 ? (1 - y) / v : v < 0 ? -y / v : 1));
    const amount = alpha * (s.mode === 'highlights' ? smooth(.08, .55, y) : 1);
    return base.map((v, i) => toSrgb(v + (y + chroma[i] * gamut - v) * amount));
}
function validateHairMask(mask) {
    const { width, height, hair } = mask;
    if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 8 || Math.max(width, height) > 512 || !(hair instanceof Float32Array) || hair.length !== width * height) throw new Error('invalid-hair-mask');
    for (const confidence of hair) if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('invalid-hair-mask');
}
/** Face-relative association, not identity recognition. Preserve full connected lengths. */
export function selectFaceHair(mask, points) {
    if (!mask) return null;
    validateHairMask(mask);
    if (!(points instanceof Float32Array) || points.length !== 1434) return null;
    let left = 1, right = 0, top = 1, bottom = 0;
    for (const index of OVAL) {
        const x = points[index * 3], y = points[index * 3 + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const fw = right - left, fh = bottom - top;
    if (fw <= 0 || fh <= 0) return null;
    // Half a face-width on either side and a face-height above accommodate curls/
    // crown volume; a quarter-height below includes side hair near the jaw.
    const anchor = { left: clamp(left - fw * .5), right: clamp(right + fw * .5), top: clamp(top - fh), bottom: clamp(bottom + fh * .25) };
    const { width, height, hair } = mask, selected = new Float32Array(hair.length);
    const seen = new Uint8Array(hair.length), queue = new Uint32Array(hair.length);
    // Match nonzero coverage after the RGBA8 upload: zero-alpha haze cannot bridge people.
    const covered = i => Math.round(hair[i] * 255) > 51;
    for (let seed = 0; seed < hair.length; seed++) {
        if (seen[seed] || !covered(seed)) continue;
        let begin = 0, end = 1, nearFace = false;
        queue[0] = seed; seen[seed] = 1;
        while (begin < end) {
            const i = queue[begin++], x = i % width, y = Math.floor(i / width);
            const nx = (x + .5) / width, ny = (y + .5) / height;
            if (hair[i] > .5 && nx >= anchor.left && nx <= anchor.right && ny >= anchor.top && ny <= anchor.bottom) nearFace = true;
            // Eight neighbours retain diagonal strands and separate side locks.
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy, next = yy * width + xx;
                if (xx < 0 || xx >= width || yy < 0 || yy >= height || seen[next] || !covered(next)) continue;
                seen[next] = 1; queue[end++] = next;
            }
        }
        if (nearFace) for (let n = 0; n < end; n++) selected[queue[n]] = hair[queue[n]];
    }
    return { width, height, hair: selected };
}
/** Validate and pack a bounded confidence texture; do not retain other person channels. */
export function hairTexture(mask) {
    if (!mask) return null;
    validateHairMask(mask);
    const { width, height, hair } = mask;
    const data = new Uint8Array(width * height * 4);
    const rows = new Float64Array(height);
    let confident = 0, mass = 0;
    for (let i = 0; i < hair.length; i++) {
        const confidence = hair[i];
        data[i * 4] = Math.round(confidence * 255); data[i * 4 + 3] = 255;
        if (confidence > .5) { const weight = hairCoverage(confidence); confident++; rows[Math.floor(i / width)] += weight; mass += weight; }
    }
    // 0.5% rejects sparse clutter without demanding a large hairstyle; always reject
    // a lone pixel even in the smallest allowed mask. Small distant hair may be off.
    if (confident < Math.max(2, Math.ceil(hair.length * .005))) return null;
    const rowAt = fraction => {
        let sum = 0;
        for (let y = 0; y < height; y++) { sum += rows[y]; if (sum >= mass * fraction) return y; }
        return height - 1;
    };
    const top = rowAt(.02), bottom = rowAt(.98);
    return { data, width, height, top: top / height, span: (bottom - top + 1) / height };
}
