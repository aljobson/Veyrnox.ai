/**
 * Geometry and per-frame parameters for the shape and motion transitions.
 * Pure functions only: the compositor draws from these for both preview and export,
 * so the two cannot disagree. Everything is deterministic in (type, progress, frame).
 */

export const NEW_TRANSITION_IDS = Object.freeze([
    'iris-open', 'iris-close', 'clock-wipe', 'barn-doors', 'blinds', 'pixel-dissolve',
    'push', 'spin', 'whip-pan', 'glitch', 'light-leak', 'cross-zoom',
]);

const BLIND_STRIPS = 8, PIXEL_COLUMNS = 16, PIXEL_ROWS = 9;
const TAU = Math.PI * 2;
const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = value => value * value * (3 - 2 * value);

/** Stable pseudo-random number in [0, 1) from three integers. */
export function hash3(a, b, seed = 0) {
    let h = Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263) + Math.imul(seed + 1, 2147483629);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const SHAPE_KIND = Object.freeze({
    'iris-open': 'iris-open',
    'iris-close': 'iris-close',
    'clock-wipe': 'clock',
    'barn-doors': 'barn',
    blinds: 'blinds',
    'pixel-dissolve': 'pixels',
});

/**
 * Parameters for the incoming and outgoing picture at progress p (0 to 1) and frame offset.
 * Returns null for transitions the original compositor code handles.
 */
export function transitionParams(type, p, offset = 0) {
    const kind = SHAPE_KIND[type];
    if (kind) return { incoming: { alpha: 1, shape: { kind, progress: p } }, outgoing: {} };
    const bump = Math.sin(p * Math.PI);
    switch (type) {
        case 'push': return { incoming: { alpha: 1, slideX: 1 - p }, outgoing: { slideX: -p } };
        case 'spin': return { incoming: { alpha: p, spin: -120 * (1 - p), zoom: 0.5 + 0.5 * p }, outgoing: {} };
        case 'whip-pan': {
            const eased = smooth(p);
            return { incoming: { alpha: 1, slideX: 1 - eased, transitionBlur: bump * 14 }, outgoing: { slideX: -eased, transitionBlur: bump * 14 } };
        }
        case 'glitch': {
            const jitterX = (hash3(offset, 1) - 0.5) * 0.12 * bump, jitterY = (hash3(offset, 2) - 0.5) * 0.03 * bump;
            return { incoming: { alpha: p >= 0.5 ? 1 : 0, slideX: jitterX, slideY: jitterY }, outgoing: { slideX: -jitterX, slideY: -jitterY } };
        }
        case 'light-leak': return { incoming: { alpha: p, leak: bump }, outgoing: {} };
        case 'cross-zoom': return { incoming: { alpha: p, zoom: 1 + (1 - p) * 0.6, transitionBlur: bump * 10 }, outgoing: { zoom: 1 + p * 0.6, transitionBlur: bump * 10 } };
        default: return null;
    }
}

const rect = (x, y, w, h) => ({ op: 'rect', args: [x, y, w, h] });

/** Path operations, in the box x, y, w, h, that clip the incoming picture. */
export function shapeClipOps(shape, x, y, w, h) {
    const p = clamp01(shape.progress), cx = x + w / 2, cy = y + h / 2, reach = Math.hypot(w, h) / 2;
    switch (shape.kind) {
        case 'iris-open': return [{ op: 'moveTo', args: [cx + reach * p, cy] }, { op: 'arc', args: [cx, cy, reach * p, 0, TAU] }];
        case 'iris-close': {
            const ops = [rect(x, y, w, h), { op: 'moveTo', args: [cx + reach * (1 - p), cy] }, { op: 'arc', args: [cx, cy, reach * (1 - p), 0, TAU] }];
            ops.evenodd = true;
            return ops;
        }
        case 'clock': return [
            { op: 'moveTo', args: [cx, cy] }, { op: 'lineTo', args: [cx, cy - reach] },
            { op: 'arc', args: [cx, cy, reach, -Math.PI / 2, -Math.PI / 2 + TAU * p] }, { op: 'closePath', args: [] },
        ];
        case 'barn': return [rect(cx - (w * p) / 2, y, w * p, h)];
        case 'blinds': {
            const strip = h / BLIND_STRIPS;
            return Array.from({ length: BLIND_STRIPS }, (_, i) => rect(x, y + i * strip, w, strip * p));
        }
        case 'pixels': {
            const cw = w / PIXEL_COLUMNS, ch = h / PIXEL_ROWS, ops = [];
            for (let row = 0; row < PIXEL_ROWS; row++) for (let col = 0; col < PIXEL_COLUMNS; col++) {
                if (hash3(col, row) < p) ops.push(rect(x + col * cw, y + row * ch, cw, ch));
            }
            return ops;
        }
        default: return [];
    }
}

/** Is the normalised point (u, v) in 0..1 inside the clipped region? */
export function shapeContains(shape, u, v) {
    const p = clamp01(shape.progress);
    const aspect = 16 / 9, dx = (u - 0.5) * aspect, dy = v - 0.5, reach = Math.hypot(aspect, 1) / 2;
    switch (shape.kind) {
        case 'iris-open': return Math.hypot(dx, dy) <= reach * p;
        case 'iris-close': return Math.hypot(dx, dy) > reach * (1 - p);
        case 'clock': {
            if (p >= 1) return true;
            const angle = (Math.atan2(dy, dx) + Math.PI / 2 + TAU) % TAU;
            return angle <= TAU * p && Math.hypot(dx, dy) <= reach;
        }
        case 'barn': return Math.abs(u - 0.5) <= p / 2;
        case 'blinds': return ((v * BLIND_STRIPS) % 1) <= p;
        case 'pixels': return hash3(Math.min(PIXEL_COLUMNS - 1, Math.floor(u * PIXEL_COLUMNS)), Math.min(PIXEL_ROWS - 1, Math.floor(v * PIXEL_ROWS))) < p;
        default: return false;
    }
}

/** Fraction of the frame the shape reveals, sampled on a regular grid. */
export function shapeCoverage(shape, columns = 64, rows = 40) {
    let inside = 0;
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
        if (shapeContains(shape, (col + 0.5) / columns, (row + 0.5) / rows)) inside++;
    }
    return inside / (columns * rows);
}

/** Apply the clip to a 2D context. Used by the compositor for the picture and its background. */
export function clipPictureShape(g, x, y, w, h, shape) {
    const ops = shapeClipOps(shape, x, y, w, h);
    g.beginPath();
    for (const { op, args } of ops) g[op](...args);
    if (ops.evenodd) g.clip('evenodd'); else g.clip();
}

/** Warm light sweep drawn over a picture; shared by the compositor and the transition previews. */
export function paintLightLeak(g, W, H, amount) {
    g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = Math.min(1, amount * 0.85);
    const cx = W * 0.75, cy = H * 0.25, gradient = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H));
    gradient.addColorStop(0, '#ffd27a'); gradient.addColorStop(0.5, 'rgba(255,120,40,.6)'); gradient.addColorStop(1, 'rgba(255,60,0,0)');
    g.fillStyle = gradient; g.fillRect(0, 0, W, H); g.restore();
}
