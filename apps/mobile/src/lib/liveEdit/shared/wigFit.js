import { WIGS } from './wigs.js';
import { OVAL, polygonFromLandmarks } from './regions.js';
import { hairCoverage, smooth } from './hair.js';

export const WIG_DEFAULTS = Object.freeze({ style: 'none', size: 1, offset: 0, strength: 1 });
const bound = (v, lo, hi, fallback) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
export function normalizeWig(value = {}) {
    return { style: WIGS.some(w => w.id === value.style) ? value.style : 'none',
        size: bound(value.size, .75, 1.3, 1), offset: bound(value.offset, -.15, .15, 0), strength: bound(value.strength, 0, 1, 1) };
}
export const validWigLandmarks = p => p instanceof Float32Array && p.length === 1434 && p.every(Number.isFinite);
/** Least-squares orientation-preserving similarity in source pixels (not normalized aspect). */
export function similarity(from, to) {
    if (from.length !== to.length || from.length < 2 || ![...from.flat(), ...to.flat()].every(Number.isFinite)) return null;
    const mean = list => list.reduce((s, p) => [s[0] + p[0] / list.length, s[1] + p[1] / list.length], [0, 0]);
    const f = mean(from), t = mean(to);
    let dot = 0, cross = 0, norm = 0;
    from.forEach((p, i) => {
        const x = p[0] - f[0], y = p[1] - f[1], u = to[i][0] - t[0], v = to[i][1] - t[1];
        dot += x * u + y * v; cross += x * v - y * u; norm += x * x + y * y;
    });
    if (norm < 1e-6) return null;
    const a = dot / norm, b = cross / norm;
    if (Math.hypot(a, b) < 1e-6) return null;
    return { a, b, tx: t[0] - a * f[0] + b * f[1], ty: t[1] - b * f[0] - a * f[1] };
}
export const transformPoint = (m, [x, y]) => [m.a * x - m.b * y + m.tx, m.b * x + m.a * y + m.ty];
// Depth-based pose proxy, not calibrated camera angles. z has the SDK's x scale.
export const WIG_POSE = Object.freeze({ fadeStart: 20, fadeEnd: 35 });
export function wigPose(points, width, height) {
    if (!validWigLandmarks(points)) return { yaw: 90, pitch: 90, fade: 0 };
    const angle = (i, j) => Math.atan2(Math.abs(points[i * 3 + 2] - points[j * 3 + 2]) * width,
        Math.hypot((points[i * 3] - points[j * 3]) * width, (points[i * 3 + 1] - points[j * 3 + 1]) * height)) * 180 / Math.PI;
    const yaw = angle(234, 454), pitch = angle(10, 152);
    const fade = 1 - smooth(WIG_POSE.fadeStart, WIG_POSE.fadeEnd, Math.max(yaw, pitch));
    return { yaw, pitch, fade };
}
export function fitWig(wig, points, width, height, settings) {
    if (!validWigLandmarks(points)) return null;
    const s = normalizeWig(settings), from = wig.anchors.map(a => a.position);
    const to = wig.anchors.map(a => [points[a.landmark * 3] * width, points[a.landmark * 3 + 1] * height]);
    const m = similarity(from, to);
    if (!m) return null;
    // Size and offset pivot around the forehead anchor, along the rolled head's vertical axis.
    const pivot = from[0], target = transformPoint(m, pivot), span = Math.hypot(m.a, m.b) * wig.dimensions[0];
    const roll = Math.atan2(m.b, m.a);
    m.a *= s.size; m.b *= s.size;
    m.tx = target[0] - m.a * pivot[0] + m.b * pivot[1] - Math.sin(roll) * span * s.offset;
    m.ty = target[1] - m.b * pivot[0] - m.a * pivot[1] + Math.cos(roll) * span * s.offset;
    return m;
}
/** Face oval minus a shallow forehead/hairline cap. Uses the verified SDK oval order. */
export function protectedFace(points) {
    const oval = polygonFromLandmarks(points, OVAL);
    if (!oval.length) return [];
    const chin = [points[152 * 3], points[152 * 3 + 1]];
    const cap = [...oval.slice(30), ...oval.slice(0, 7)].map(p => p.map((v, axis) => v * .88 + chin[axis] * .12));
    return [...oval.slice(7, 30), ...cap];
}
/** Actual final silhouette alpha sampled at the hair-mask grid; opacity/pose count as uncovered. */
export function wigCoverage(mask, alpha, strength = 1) {
    if (!mask || !alpha || alpha.length !== mask.hair.length) return { fraction: 0, hint: false, known: false };
    let mass = 0, uncovered = 0;
    for (let i = 0; i < alpha.length; i++) {
        const weight = hairCoverage(Math.round(mask.hair[i] * 255) / 255);
        mass += weight; uncovered += weight * (1 - bound(alpha[i], 0, 1, 0) * bound(strength, 0, 1, 0));
    }
    const fraction = mass ? uncovered / mass : 0;
    return { fraction, hint: mass >= 2 && fraction > .15, known: true };
}
/** Edge-only feathering: the hair confidence never subtracts source/photo pixels. */
export function wigEdgeAlpha(alpha, confidence) {
    return alpha * (1 - .18 * hairCoverage(confidence) * (1 - smooth(.1, .9, alpha)));
}
