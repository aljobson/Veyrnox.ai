export const EDITOR_CANVAS_PRESETS = Object.freeze(['source', '16:9', '9:16', '1:1', '4:5']);
export const PROJECT_CANVAS_PRESETS = Object.freeze(['16:9', '9:16', '1:1', '4:5']);

const CUSTOM = /^custom:([1-9][0-9]{0,2})x([1-9][0-9]{0,2})$/;
const PRESET_SIZES = Object.freeze({
    '16:9': Object.freeze({ width: 16, height: 9 }),
    '9:16': Object.freeze({ width: 9, height: 16 }),
    '1:1': Object.freeze({ width: 1, height: 1 }),
    '4:5': Object.freeze({ width: 4, height: 5 }),
});

const gcd = (a, b) => {
    let x = Math.abs(a), y = Math.abs(b);
    while (y) [x, y] = [y, x % y];
    return x;
};
const boundedRatio = (width, height) => width * 4 >= height && width <= height * 4;

/** Convert bounded integer fields to the one persisted custom-canvas spelling. */
export function formatCustomCanvasAspect(width, height) {
    const w = typeof width === 'string' && width.trim() ? Number(width) : width;
    const h = typeof height === 'string' && height.trim() ? Number(height) : height;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 100 || h > 100 || !boundedRatio(w, h)) return null;
    const divisor = gcd(w, h);
    return ['custom', [w / divisor, h / divisor].join('x')].join(':');
}

/** Parse only canonical persisted custom ratios; unreduced aliases are rejected. */
export function customCanvasParts(value) {
    if (typeof value !== 'string') return null;
    const match = CUSTOM.exec(value);
    if (!match) return null;
    const width = Number(match[1]), height = Number(match[2]);
    if (formatCustomCanvasAspect(width, height) !== value) return null;
    return { width, height };
}

export function validCanvasAspect(value, { allowSource = false } = {}) {
    return (allowSource && value === 'source') || PROJECT_CANVAS_PRESETS.includes(value) || customCanvasParts(value) !== null;
}

/** Return the ratio's reduced logical dimensions, or real source dimensions for `source`. */
export function canvasAspectSize(value, sourceWidth = 0, sourceHeight = 0) {
    if (value === 'source') {
        return Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight) && sourceWidth > 0 && sourceHeight > 0
            ? { width: sourceWidth, height: sourceHeight } : null;
    }
    return typeof value === 'string' && Object.hasOwn(PRESET_SIZES, value) ? PRESET_SIZES[value] : customCanvasParts(value);
}

export function canvasAspectRatio(value, sourceWidth = 0, sourceHeight = 0) {
    const size = canvasAspectSize(value, sourceWidth, sourceHeight);
    return size ? size.width / size.height : null;
}

/** Recover an editor canvas ID from interchange dimensions when no Veyrnox metadata exists. */
export function canvasAspectFromDimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !boundedRatio(width, height)) return null;
    const divisor = gcd(width, height), w = width / divisor, h = height / divisor;
    for (const [preset, size] of Object.entries(PRESET_SIZES)) if (size.width === w && size.height === h) return preset;
    return w <= 100 && h <= 100 ? ['custom', [w, h].join('x')].join(':') : null;
}

const even = value => Math.max(2, Math.round(value / 2) * 2);

/** Existing web/local-export sizing: choose a height, then cap wide canvases without changing the ratio. */
export function canvasPixelSize(value, targetHeight = 720, maximumWidth = 1920, sourceWidth = 0, sourceHeight = 0) {
    const ratio = canvasAspectRatio(value, sourceWidth, sourceHeight) ?? 16 / 9;
    let height = targetHeight, width = height * ratio;
    if (width > maximumWidth) { width = maximumWidth; height = width / ratio; }
    return { width: even(width), height: even(height) };
}

/** Server resolution uses the selected resolution as the short edge, independently of canvas shape. */
export function canvasResolutionSize(value, edge, sourceWidth = 0, sourceHeight = 0) {
    const ratio = canvasAspectRatio(value, sourceWidth, sourceHeight);
    if (!ratio || !Number.isFinite(edge) || edge <= 0) return null;
    return ratio >= 1
        ? { width: even(edge * ratio), height: even(edge) }
        : { width: even(edge), height: even(edge / ratio) };
}
