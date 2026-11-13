import { WIG_DEFAULTS, normalizeWig, validWigLandmarks, wigPose } from './wigFit.js';
import { smooth } from './hair.js';

// Original procedural 3D wigs (ADR-0338 S6). No third-party meshes, textures or provider output:
// the shape is plain maths below, so there is no art licence to track. They are stylised wigs.
export const WIG3D_VERSION = 1;
export const THREE_VERSION = '0.187.0';
export const THREE_URL = `/photo-studio/vendor/three-${THREE_VERSION}/three.module.js`;
export const WIGS_3D = Object.freeze([
    { id: '3d-pixie', nameKey: 'app.photoStudio.wig3d.pixie', source: 'authored by Veyrnox in code', licence: 'owned', length: .06, volume: 1.04, fringe: .1, flare: .02, sweep: .35 },
    { id: '3d-bob', nameKey: 'app.photoStudio.wig3d.bob', source: 'authored by Veyrnox in code', licence: 'owned', length: .62, volume: 1.1, fringe: .3, flare: .14, sweep: .1 },
    { id: '3d-long', nameKey: 'app.photoStudio.wig3d.long', source: 'authored by Veyrnox in code', licence: 'owned', length: 1.5, volume: 1.12, fringe: 0, flare: .24, sweep: 0 },
    { id: '3d-fringe', nameKey: 'app.photoStudio.wig3d.fringe', source: 'authored by Veyrnox in code', licence: 'owned', length: .95, volume: 1.14, fringe: .62, flare: .18, sweep: 0 },
]);
export const isWig3d = style => WIGS_3D.some(w => w.id === style);
/** Web settings accept a 3D style id as well; the shared 2D normalizer (also used by mobile) is untouched. */
export function normalizeWigWeb(value = {}) {
    const base = normalizeWig({ ...value, style: 'none' });
    return isWig3d(value?.style) ? { ...base, style: value.style } : normalizeWig(value);
}
export { WIG_DEFAULTS };

// Rotation proxy is z-based like wigPose, but the 3D wig turns with the head, so it fades later.
export const WIG3D_POSE = Object.freeze({ fadeStart: 40, fadeEnd: 62 });
export const wig3dFade = (points, width, height) => {
    const { yaw, pitch } = wigPose(points, width, height);
    return 1 - smooth(WIG3D_POSE.fadeStart, WIG3D_POSE.fadeEnd, Math.max(yaw, pitch));
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const n = len(a); return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : null; };
const mix = (a, b, t) => a + (b - a) * t;

/**
 * Head frame in source pixels from 478 landmarks. Space: x right, y DOWN, z toward the viewer (landmark
 * z is negated, scaled like x). Local axes: right (+x of the head), up, forward (out of the face).
 */
export function headFrame(points, width, height) {
    if (!validWigLandmarks(points) || !(width > 0) || !(height > 0)) return null;
    const P = i => [points[i * 3] * width, points[i * 3 + 1] * height, -points[i * 3 + 2] * width];
    const left = P(234), right0 = P(454), top = P(10), chin = P(152);
    let right = unit(sub(right0, left)); if (!right) return null;
    const upRaw = sub(top, chin);
    let up = unit(sub(upRaw, right.map(v => v * dot(upRaw, right)))); if (!up) return null;
    const forward = unit(cross(up, right)); if (!forward) return null;
    right = unit(cross(forward, up));
    const s = len(sub(right0, left)) / 2, h = len(upRaw);
    if (!(s > 1) || !(h > 1)) return null;
    return { origin: left.map((v, i) => (v + right0[i]) / 2), right, up, forward, s, h };
}

/** Column-major 4x4 for three.js: local x in units of s, y in units of h, z in units of s. */
export function wigMatrix(frame, settings) {
    const k = normalizeWigWeb(settings).size, offset = normalizeWigWeb(settings).offset;
    const o = frame.origin.map((v, i) => v - frame.up[i] * offset * frame.s * 2);
    return [
        ...frame.right.map(v => v * frame.s * k), 0, ...frame.up.map(v => v * frame.h * k), 0,
        ...frame.forward.map(v => v * frame.s * k), 0, ...o, 1,
    ];
}

// Head proxy radii/centre in local units; the depth-only occluder uses it, and wigs sit just outside it.
export const HEAD = Object.freeze({ centre: [0, .3, -.08], radii: [.96, .6, .98] });
const HAIRLINE = .56, FACE_HALF = .98;

/** The face opening: in front of the head, between the temples, under the (style-shaped) hairline. */
export const hairlineAt = (def, x) => HAIRLINE - def.fringe * .17 * (1 - Math.min(1, (x / FACE_HALF) ** 2)) - def.sweep * .08 * Math.max(0, x);
export const inFaceWindow = (style, x, y, z) => {
    const def = WIGS_3D.find(w => w.id === style);
    return Boolean(def) && z > .1 && Math.abs(x) < FACE_HALF && y < hairlineAt(def, x);
};
/** The same test per pixel on the GPU, so the hairline is a smooth curve at any photo size (no grid staircase). */
export const faceWindowGlsl = style => {
    const def = WIGS_3D.find(w => w.id === style), f = v => Number(v).toFixed(4);
    if (!def) return null;
    // Squares by multiplication: pow() of a negative base (the left half of the wig) is undefined in GLSL ES.
    return `float fx = vLocal.x / ${f(FACE_HALF)};\n`
        + `float hl = ${f(HAIRLINE)} - ${f(def.fringe * .17)} * (1.0 - min(1.0, fx * fx)) - ${f(def.sweep * .08)} * max(0.0, vLocal.x);\n`
        + `if (vLocal.z > 0.1 && abs(vLocal.x) < ${f(FACE_HALF)} && vLocal.y < hl) discard;`;
};

/**
 * Wig shell in local units (x,z in s; y in h, origin between the ears). Top -> dome -> equator ->
 * skirt -> hem along t; around the head by azimuth (0 = front). The shell is a full closed surface;
 * the face opening is cut by faceWindowGlsl in the shader (and the 2D carve backstops the face).
 */
export function buildWigMesh(style, { around = 64, along = 44 } = {}) {
    const def = WIGS_3D.find(w => w.id === style);
    if (!def) return null;
    const rx = HEAD.radii[0] * def.volume + .06, ry = HEAD.radii[1] * def.volume + .05, rz = HEAD.radii[2] * def.volume + .06;
    const cy = HEAD.centre[1], cz = HEAD.centre[2], dome = Math.round(along * .55);
    const positions = [], colors = [];
    for (let j = 0; j <= along; j++) {
        for (let i = 0; i < around; i++) {
            const theta = (i / around) * Math.PI * 2, sx = Math.sin(theta), cz0 = Math.cos(theta);
            let x, y, z, shade;
            if (j <= dome) {
                const a = (j / dome) * Math.PI / 2, ring = Math.sin(a);
                x = rx * ring * sx; y = cy + ry * Math.cos(a); z = cz + rz * ring * cz0;
                shade = .86 + .14 * Math.cos(a);
            } else {
                const u = (j - dome) / (along - dome);
                // Back and sides hang the full length; the front falls at the temples only.
                const hang = def.length * mix(.55, 1, smooth(.15, .7, Math.abs(Math.cos(theta / 2 + Math.PI / 2))));
                const ring = 1 + def.flare * Math.pow(u, 1.4) - .06 * u * u;
                x = rx * ring * sx; z = cz + rz * ring * cz0; y = cy - u * (.3 + hang) * (1 - .08 * Math.abs(sx));
                shade = mix(.86, .62, u);
            }
            const strand = .93 + .07 * Math.sin(theta * 46 + (j > dome ? 0 : j * .35) + Math.sin(theta * 7) * 2);
            positions.push(x, y, z);
            const c = shade * strand; colors.push(.5 * c, .27 * c, .13 * c);
        }
    }
    const indices = [];
    for (let j = 0; j < along; j++) {
        for (let i = 0; i < around; i++) {
            const i2 = (i + 1) % around, a = j * around + i, b = j * around + i2, c = (j + 1) * around + i, d = (j + 1) * around + i2;
            indices.push(a, b, c, b, d, c);
        }
    }
    return { positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint32Array(indices), vertices: positions.length / 3 };
}
