export const MASK_DEFAULTS = Object.freeze({ x: 0.5, y: 0.5, width: 1, height: 1, rotation: 0, feather: 0, inverted: false });
const geometry = ['x', 'y', 'width', 'height', 'rotation', 'feather'];
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const range = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const validGeometry = v => range(v.x, -1, 2) && range(v.y, -1, 2) && range(v.width, 0.05, 2) && range(v.height, 0.05, 2) && range(v.rotation, -360, 360) && range(v.feather, 0, 0.25);
export function maskDefaults(type) {
    return { ...MASK_DEFAULTS, ...(type === 'horizontal' ? { y: 0.25, height: 0.5 } : type === 'vertical' ? { x: 0.25, width: 0.5 } : {}) };
}
export function maskProblem(clip) {
    if (clip.maskSettings !== undefined && (!exact(clip.maskSettings, Object.keys(MASK_DEFAULTS)) || !validGeometry(clip.maskSettings) || typeof clip.maskSettings.inverted !== 'boolean')) return 'Invalid mask geometry.';
    if (clip.maskKeyframes !== undefined && (!Array.isArray(clip.maskKeyframes) || clip.maskKeyframes.length > 40 || clip.maskKeyframes.some((k, i) => !exact(k, ['frame', ...geometry, 'easing']) || !Number.isInteger(k.frame) || k.frame < -18000 || k.frame > 18000 || !validGeometry(k) || (i > 0 && k.frame <= clip.maskKeyframes[i - 1].frame) || !['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(k.easing)))) return 'Invalid mask keyframes.';
    return null;
}
const ease = (p, mode) => mode === 'ease-in' ? p * p : mode === 'ease-out' ? 1 - (1 - p) ** 2 : mode === 'ease-in-out' ? p * p * (3 - 2 * p) : p;
export function evaluatedMask(clip, offset) {
    const settings = { ...maskDefaults(clip.mask), ...clip.maskSettings }, keys = clip.maskKeyframes || [];
    if (keys.length) {
        const left = [...keys].reverse().find(k => k.frame <= offset) || keys[0], right = keys.find(k => k.frame >= offset) || keys.at(-1);
        const p = left.frame === right.frame ? 0 : ease(Math.max(0, Math.min(1, (offset - left.frame) / (right.frame - left.frame))), right.easing);
        for (const key of geometry) settings[key] = left[key] + (right[key] - left[key]) * p;
    }
    return settings;
}
export function maskKeyframe(clip, frame) {
    const settings = evaluatedMask(clip, frame);
    return { frame, ...Object.fromEntries(geometry.map(k => [k, settings[k]])), easing: 'linear' };
}
/** Retain keys beyond a trimmed boundary so easing and extensions preserve the same motion. */
export function sliceMaskKeyframes(clip, from) {
    return clip.maskKeyframes?.map(k => ({ ...k, frame: k.frame - from }));
}
export function maskShape(g, type, w, h) {
    g.beginPath();
    if (type === 'circle') g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (type === 'rounded') g.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.15);
    else g.rect(-w / 2, -h / 2, w, h);
}
/** Shared preview/export alpha composition. Bound temporary surfaces to the output size. */
export function maskedPicture(pic, crop, clip, offset, outputWidth, outputHeight) {
    const ratio = Math.min(1, 4096 / Math.max(outputWidth, outputHeight));
    const w = Math.max(1, Math.round(outputWidth * ratio)), h = Math.max(1, Math.round(outputHeight * ratio));
    const out = new OffscreenCanvas(w, h), g = out.getContext('2d');
    g.drawImage(pic, pic.width * crop.x, pic.height * crop.y, pic.width * crop.width, pic.height * crop.height, 0, 0, w, h);
    const mask = new OffscreenCanvas(w, h), alpha = mask.getContext('2d'), settings = evaluatedMask(clip, offset);
    if (settings.inverted) { alpha.fillStyle = '#ffffff'; alpha.fillRect(0, 0, w, h); }
    alpha.save();
    alpha.translate(settings.x * w, settings.y * h); alpha.rotate(settings.rotation * Math.PI / 180);
    alpha.filter = settings.feather ? `blur(${settings.feather * Math.min(w, h)}px)` : 'none';
    alpha.globalCompositeOperation = settings.inverted ? 'destination-out' : 'source-over';
    alpha.fillStyle = '#ffffff'; maskShape(alpha, clip.mask, w * settings.width, h * settings.height); alpha.fill(); alpha.restore();
    g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0);
    return out;
}
