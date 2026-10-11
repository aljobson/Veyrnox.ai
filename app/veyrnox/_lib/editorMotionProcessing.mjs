import { assertPicture, flowAt, globalMotion } from './editorMotionAnalysis.mjs';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const MOTION_TOOLS = Object.freeze(['stabilize', 'flicker', 'optical-flow', 'track-reframe', 'camera-movement']);
export const MOTION_VIDEO_LIMITS = Object.freeze({ sourceSeconds: 30, opticalSeconds: 10, sourceBytes: 100 * 1024 * 1024, outputBytes: 100 * 1024 * 1024, height: 720, opticalHeight: 480, frames: 1800 });
export function validateMotionOptions(options = {}) {
    if (!MOTION_TOOLS.includes(options.tool)) return 'Choose a picture processing tool.';
    if (options.frameRate !== undefined && ![24, 25, 30, 50, 60].includes(options.frameRate)) return 'Choose a supported output frame rate.';
    if (options.height !== undefined && ![360, 480, 720].includes(options.height)) return 'Choose a supported output size.';
    if (options.tool === 'optical-flow' && options.height > MOTION_VIDEO_LIMITS.opticalHeight) return 'Optical flow currently supports up to 480p.';
    if (options.smoothing !== undefined && (!Number.isInteger(options.smoothing) || options.smoothing < 1 || options.smoothing > 30)) return 'Choose a smoothing window from 1 to 30 frames.';
    if (options.strength !== undefined && (!Number.isFinite(options.strength) || options.strength < 0 || options.strength > 1)) return 'Choose a processing strength from 0 to 1.';
    if (options.tool === 'track-reframe') {
        if (![9 / 16, 1, 16 / 9].includes(options.aspect)) return 'Choose a portrait, square or landscape output.';
        const region = options.region;
        if (!region || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(region[k]) && region[k] >= 0 && region[k] <= 1) || region.width < .05 || region.height < .05 || region.x + region.width > 1 || region.y + region.height > 1) return 'Select a textured subject region inside the picture.';
    }
    if (options.tool === 'camera-movement') {
        for (const point of [options.from, options.to]) if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.zoom) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 || point.zoom < 1 || point.zoom > 3) return 'Choose bounded start and end camera positions.';
    }
    return null;
}
/** Clamp an aspect-ratio crop to source bounds while keeping its tracked centre in view. */
export function trackedCrop(width, height, aspect, centre = { x: .5, y: .5 }, zoom = 1) {
    if (![width, height, aspect, zoom, centre.x, centre.y].every(Number.isFinite) || width < 8 || height < 8 || aspect <= 0 || zoom < 1 || zoom > 3 || centre.x < 0 || centre.x > 1 || centre.y < 0 || centre.y > 1) throw new Error('Choose bounded camera framing.');
    let w = width, h = height;
    if (w / h > aspect) w = h * aspect; else h = w / aspect;
    w /= zoom; h /= zoom;
    return { x: clamp(centre.x * width - w / 2, 0, width - w), y: clamp(centre.y * height - h / 2, 0, height - h), width: w, height: h };
}
export function movementCrop(width, height, from, to, fraction) {
    const t = clamp(fraction, 0, 1), eased = t * t * (3 - 2 * t);
    return trackedCrop(width, height, width / height, { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased }, from.zoom + (to.zoom - from.zoom) * eased);
}
export function stabilizationZoom(samples, width, height, strength = 1) {
    let x = 0, y = 0;
    for (const sample of samples) { x = Math.max(x, Math.abs(sample.correctionX) * strength); y = Math.max(y, Math.abs(sample.correctionY) * strength); }
    return Math.max(width / Math.max(width * .6, width - 2 * x), height / Math.max(height * .6, height - 2 * y));
}
export function applyExposure(picture, gain) {
    assertPicture(picture, 4);
    if (!Number.isFinite(gain) || gain < .5 || gain > 2) throw new Error('Choose a bounded exposure correction.');
    const data = new Uint8ClampedArray(picture.data.length);
    for (let i = 0; i < data.length; i += 4) { data[i] = picture.data[i] * gain; data[i + 1] = picture.data[i + 1] * gain; data[i + 2] = picture.data[i + 2] * gain; data[i + 3] = picture.data[i + 3]; }
    return { width: picture.width, height: picture.height, data };
}
function pixel(frame, x, y, channel) {
    x = clamp(x, 0, frame.width - 1); y = clamp(y, 0, frame.height - 1);
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, nextX = Math.min(frame.width - 1, ix + 1), nextY = Math.min(frame.height - 1, iy + 1);
    return frame.data[(iy * frame.width + ix) * 4 + channel] * (1 - fx) * (1 - fy) + frame.data[(iy * frame.width + nextX) * 4 + channel] * fx * (1 - fy) + frame.data[(nextY * frame.width + ix) * 4 + channel] * (1 - fx) * fy + frame.data[(nextY * frame.width + nextX) * 4 + channel] * fx * fy;
}
export function warpPicture(frame, { translateX = 0, translateY = 0, zoom = 1 } = {}) {
    assertPicture(frame, 4);
    if (![translateX, translateY, zoom].every(Number.isFinite) || zoom < 1 || zoom > 3 || Math.abs(translateX) > frame.width || Math.abs(translateY) > frame.height) throw new Error('Choose bounded picture movement.');
    const data = new Uint8ClampedArray(frame.data.length);
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) for (let c = 0; c < 4; c++) data[(y * frame.width + x) * 4 + c] = pixel(frame, (x - frame.width / 2) / zoom + frame.width / 2 - translateX, (y - frame.height / 2) / zoom + frame.height / 2 - translateY, c);
    return { width: frame.width, height: frame.height, data };
}
/** Bidirectional motion-compensated interpolation. Unreliable flow and cuts use a nearest frame. */
export function interpolateMotionPictures(a, b, forward, backward, fraction) {
    assertPicture(a, 4); assertPicture(b, 4);
    if (a.width !== b.width || a.height !== b.height || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 || forward.width !== backward.width || forward.height !== backward.height) throw new Error('Choose matching interpolation pictures.');
    if (fraction === 0) return a; if (fraction === 1) return b;
    if (globalMotion(forward).cut || globalMotion(backward).cut) return fraction < .5 ? a : b;
    const data = new Uint8ClampedArray(a.data.length), sx = a.width / forward.width, sy = a.height / forward.height;
    const fm = globalMotion(forward), bm = globalMotion(backward), uniform = fm.confidence > .5 && bm.confidence > .5 && forward.vectors.every(v => v.confidence < .45 || (v.x === fm.x && v.y === fm.y)) && backward.vectors.every(v => v.confidence < .45 || (v.x === bm.x && v.y === bm.y)) && Math.hypot(fm.x + bm.x, fm.y + bm.y) < .1;
    if (uniform) {
        // Exact translational flow has one vector, avoiding redundant grid lookup per pixel.
        for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) for (let c = 0; c < 4; c++) data[(y * a.width + x) * 4 + c] = pixel(a, x - fraction * fm.x * sx, y - fraction * fm.y * sy, c) * (1 - fraction) + pixel(b, x - (1 - fraction) * bm.x * sx, y - (1 - fraction) * bm.y * sy, c) * fraction;
        return { width: a.width, height: a.height, data };
    }
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
        const f = flowAt(forward, x / sx, y / sy), r = flowAt(backward, x / sx, y / sy);
        const ax = x - fraction * f.x * sx, ay = y - fraction * f.y * sy, bx = x - (1 - fraction) * r.x * sx, by = y - (1 - fraction) * r.y * sy;
        const fa = flowAt(forward, ax / sx, ay / sy), rb = flowAt(backward, bx / sx, by / sy);
        const reverseAtA = flowAt(backward, (ax / sx + fa.x), (ay / sy + fa.y)), forwardAtB = flowAt(forward, (bx / sx + rb.x), (by / sy + rb.y));
        const trustA = fa.confidence > .4 && Math.hypot(fa.x + reverseAtA.x, fa.y + reverseAtA.y) < 2.5, trustB = rb.confidence > .4 && Math.hypot(rb.x + forwardAtB.x, rb.y + forwardAtB.y) < 2.5;
        for (let c = 0; c < 4; c++) {
            const offset = (y * a.width + x) * 4 + c;
            data[offset] = trustA && trustB ? pixel(a, ax, ay, c) * (1 - fraction) + pixel(b, bx, by, c) * fraction : trustA ? pixel(a, ax, ay, c) : trustB ? pixel(b, bx, by, c) : (fraction < .5 ? a.data[offset] : b.data[offset]);
        }
    }
    return { width: a.width, height: a.height, data };
}
