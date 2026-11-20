export type Vec3 = [number, number, number];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (v: Vec3): Vec3 => { const n = Math.hypot(...v); return n ? v.map(x => x / n) as Vec3 : [0, 0, 1]; };
const clamp = (x: number) => Math.max(0, Math.min(1, x));
// three 0.187 colorspace_pars_fragment / ColorManagement: IEC 61966-2-1 transfer.
export const linearToSrgb = (x: number) => clamp(x <= .0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - .055);
export const srgbToLinear = (x: number) => x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4);
const ground = [0x55, 0x4a, 0x42].map(x => srgbToLinear(x / 255));
const light = unit([-.4, -1, 2]), half = unit([light[0], light[1], light[2] + 1]);

/** Vertex approximation, NOT pixel parity with MeshStandardMaterial.
 * Sources: bundled public/photo-studio/vendor/three-0.187.0/three.module.js,
 * lights_pars_begin (hemisphere), lights_physical_pars_fragment (D_GGX,
 * V_GGX_SmithCorrelated), common (F_Schlick), and web wig3dLayer.js (lights/material).
 * Orthographic view=(0,0,1); DoubleSide flips toward viewer. Hemisphere defaults to
 * world +y (even though this photo's y points down). Intensities 1.2 and 1.6,
 * roughness .55, metalness 0, dielectric F0=.04, F90=1. Lambert uses 1/pi.
 * GGX alpha=roughness²; EPSILON=1e-6 is three's denominator guard. Schlick's
 * exp2 fit constants -5.55473/-6.98316 come from common.F_Schlick.
 * Omits fragment normal interpolation, derivative roughness and indirect specular
 * / DFG energy compensation. Linear vertex lighting is converted to sRGB here;
 * Skia interpolates those output colours. No tone mapping (web default).
 */
export function lightVertex(normal: Vec3, base: Vec3): Vec3 {
    const out = { r: 0, g: 0, b: 0 };
    lightVertexInto(...normal, ...base, out);
    return [out.r, out.g, out.b];
}

/** Allocation-free lighting kernel for the yielding vertex loop. */
export function lightVertexInto(nx: number, ny: number, nz: number, r: number, g: number, b: number, out: { r: number; g: number; b: number }): void {
    const length = Math.hypot(nx, ny, nz);
    if (length) { nx /= length; ny /= length; nz /= length; } else { nx = 0; ny = 0; nz = 1; }
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = clamp(nx * light[0] + ny * light[1] + nz * light[2]), nv = clamp(nz);
    const nh = clamp(nx * half[0] + ny * half[1] + nz * half[2]), vh = clamp(half[2]);
    const a2 = .55 ** 4, denom = nh * nh * (a2 - 1) + 1;
    const distribution = a2 / (Math.PI * denom * denom);
    const visibility = .5 / Math.max(1e-6, nl * Math.sqrt(a2 + (1 - a2) * nv * nv) + nv * Math.sqrt(a2 + (1 - a2) * nl * nl));
    const fresnel = .04 + .96 * 2 ** ((-5.55473 * vh - 6.98316) * vh);
    const hemiWeight = .5 * ny + .5, specular = 1.6 * nl * distribution * visibility * fresnel;
    out.r = linearToSrgb(r * (1.2 * (ground[0] + (1 - ground[0]) * hemiWeight) + 1.6 * nl) / Math.PI + specular);
    out.g = linearToSrgb(g * (1.2 * (ground[1] + (1 - ground[1]) * hemiWeight) + 1.6 * nl) / Math.PI + specular);
    out.b = linearToSrgb(b * (1.2 * (ground[2] + (1 - ground[2]) * hemiWeight) + 1.6 * nl) / Math.PI + specular);
}

/** Area-weighted smooth normals, matching BufferGeometry.computeVertexNormals. */
export function smoothNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
        const u = [positions[c] - positions[b], positions[c + 1] - positions[b + 1], positions[c + 2] - positions[b + 2]];
        const v = [positions[a] - positions[b], positions[a + 1] - positions[b + 1], positions[a + 2] - positions[b + 2]];
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        for (const j of [a, b, c]) for (let k = 0; k < 3; k++) normals[j + k] += cross[k];
    }
    for (let i = 0; i < normals.length; i += 3) {
        const n = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
        if (n) for (let k = 0; k < 3; k++) normals[i + k] /= n;
    }
    return normals;
}
