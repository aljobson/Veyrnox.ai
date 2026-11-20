import { dot, unit, lightVertexInto, smoothNormals, type Vec3 } from './wig3dLighting';

type Definition = { id: string; fringe: number; sweep: number };
type Mesh = { positions: Float32Array; colors: Float32Array; indices: Uint32Array };
const { HEAD, WIGS_3D, buildWigMesh, hairlineAt, inFaceWindow } = require('./shared/wig3d') as {
    HEAD: { centre: Vec3; radii: Vec3 }; WIGS_3D: Definition[];
    buildWigMesh(style: string): Mesh | null;
    hairlineAt(def: Definition, x: number): number;
    inFaceWindow(style: string, x: number, y: number, z: number): boolean;
};
const meshes = new Map<string, Mesh & { normals: Float32Array }>();
export type Vertex = { x: number; y: number; z: number; sx: number; sy: number; sz: number; r: number; g: number; b: number };
export type Triangle = [Vertex, Vertex, Vertex];
export type GeometryStats = { input: number; kept: number; dropped: number; splits: number; boundaryLeaves: number; maxBoundaryEdge: number };
type Classification = -1 | 0 | 1; // outside / uncertain / inside the discarded region
type Interval = [number, number];
const range = (v: number[]): Interval => [Math.min(...v), Math.max(...v)];
const squareRange = ([lo, hi]: Interval): Interval => [lo <= 0 && hi >= 0 ? 0 : Math.min(lo * lo, hi * hi), Math.max(lo * lo, hi * hi)];
const normRange = (v: Vec3[]): Interval => {
    const r = [0, 1, 2].map(k => squareRange(range(v.map(p => p[k]))));
    return [r.reduce((s, a) => s + a[0], 0), r.reduce((s, a) => s + a[1], 0)];
};
export const transform = (m: number[], p: Vec3): Vec3 => [0, 1, 2].map(k => m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12]) as Vec3;

/** wigMatrix has orthogonal, independently scaled columns. This is its inverse
 * linear transform applied to SCREEN +z, not local +z. Dividing by HEAD.radii
 * maps the ellipsoid to the unit sphere, preserving the forward ray parameter.
 */
export function proxyRay(matrix: number[]): Vec3 {
    return unit([0, 4, 8].map((k, i) => matrix[k + 2] / (matrix[k] ** 2 + matrix[k + 1] ** 2 + matrix[k + 2] ** 2) / HEAD.radii[i]) as Vec3);
}
const spherePoint = (p: Vec3): Vec3 => p.map((v, i) => (v - HEAD.centre[i]) / HEAD.radii[i]) as Vec3;
export function behindProxy(local: Vec3, ray: Vec3): boolean {
    const q = spherePoint(local), b = dot(q, ray), discriminant = b * b - dot(q, q) + 1;
    return discriminant >= 0 && -b + Math.sqrt(discriminant) > 0;
}

/** Bounds apply to the ENTIRE affine triangle, not just vertex samples. AABB
 * interval arithmetic over q and its projection perpendicular to the ray gives
 * conservative bounds on c=|q|²-1 and D=1-|q_perp|². The forward sphere root is
 * -b+sqrt(D). Only proven homogeneous regions may avoid subdivision. Thus a
 * silhouette passing through a triangle with three agreeing vertices is caught.
 */
export function proxyClass(points: Vec3[], ray: Vec3): Classification {
    const q = points.map(spherePoint), bs = q.map(p => dot(p, ray)), [blo, bhi] = range(bs);
    const perpendicular = q.map((p, i) => p.map((v, k) => v - bs[i] * ray[k]) as Vec3);
    const [pmin, pmax] = normRange(perpendicular), [qmin, qmax] = normRange(q);
    if (pmin > 1 || (blo >= 0 && qmin > 1)) return -1;
    if (pmax < 1 && (bhi < 0 || qmax < 1)) return 1;
    return 0;
}

function windowClass(points: Vec3[], def: Definition): Classification {
    const [xmin, xmax] = range(points.map(p => p[0])), [ymin, ymax] = range(points.map(p => p[1])), [zmin, zmax] = range(points.map(p => p[2]));
    // Extrema of shared hairlineAt's piecewise quadratic: endpoints, knots and
    // its positive-x stationary point. Values outside this x interval are ignored.
    const stationary = def.fringe ? def.sweep * .08 * .98 ** 2 / (2 * def.fringe * .17) : 0;
    const xs = [xmin, xmax, ...[-.98, 0, .98, stationary].filter(x => x >= xmin && x <= xmax)];
    const [hmin, hmax] = range(xs.map(x => hairlineAt(def, x)));
    if (zmax <= .1 || xmin >= .98 || xmax <= -.98 || ymin >= hmax) return -1;
    if (zmin > .1 && xmin > -.98 && xmax < .98 && ymax < hmin) return 1;
    return 0;
}
const midpoint = (a: Vertex, b: Vertex): Vertex => ({
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
    sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2, sz: (a.sz + b.sz) / 2,
    r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2,
});
export const projectedEdge = (a: Vertex, b: Vertex) => Math.hypot(a.sx - b.sx, a.sy - b.sy);

/** Stable bottom-up merge sort preserves exact centroid-z painter ordering and
 * tie order without a monolithic Array.sort. Yield every 256 output triangles,
 * including the copy tails. Both work arrays are released on cancellation.
 */
function* sortTriangles(triangles: Triangle[]): Generator<void, Triangle[]> {
    let source = triangles, target = new Array<Triangle>(triangles.length), copied = 0;
    const depth = (t: Triangle) => t[0].sz + t[1].sz + t[2].sz;
    for (let width = 1; width < source.length; width *= 2) {
        for (let lo = 0; lo < source.length; lo += width * 2) {
            const mid = Math.min(lo + width, source.length), hi = Math.min(lo + width * 2, source.length);
            let left = lo, right = mid;
            for (let out = lo; out < hi; out++) {
                target[out] = right === hi || (left < mid && depth(source[left]) <= depth(source[right])) ? source[left++] : source[right++];
                if (++copied % 256 === 0) yield;
            }
        }
        const previous = source; source = target; target = previous;
    }
    return source;
}

/** Yields at most every 256 classification operations, including deep splits.
 * Terminal uncertain triangles have all projected edges <= 1 OVERLAY pixel.
 * No depth cap can silently relax that bound. Painter order remains approximate
 * for intersecting wig triangles; the proxy and face window use the bound above.
 */
export function* wigGeometry(style: string, matrix: number[], scale: [number, number], stats: GeometryStats): Generator<void, Triangle[]> {
    const def = WIGS_3D.find(d => d.id === style);
    if (!def) throw Error('unknown-wig');
    if (!meshes.has(style)) {
        const mesh = buildWigMesh(style); if (!mesh) throw Error('missing-wig');
        meshes.set(style, { ...mesh, normals: smoothNormals(mesh.positions, mesh.indices) });
    }
    const mesh = meshes.get(style)!, vertices: Vertex[] = [], ray = proxyRay(matrix);
    // Inverse transpose for nonuniform head scale. Compute once, outside the
    // lighting loop; scalar vertices avoid temporary per-vertex vector arrays.
    const normalMatrix = matrix.slice(0, 12);
    for (const j of [0, 4, 8]) {
        const norm2 = matrix[j] ** 2 + matrix[j + 1] ** 2 + matrix[j + 2] ** 2;
        for (let k = 0; k < 3; k++) normalMatrix[j + k] /= norm2;
    }
    for (let i = 0; i < mesh.positions.length; i += 3) {
        if (i % (256 * 3) === 0) yield;
        const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
        const nx = mesh.normals[i], ny = mesh.normals[i + 1], nz = mesh.normals[i + 2];
        const vertex: Vertex = { x, y, z,
            sx: (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * scale[0],
            sy: (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * scale[1],
            sz: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14], r: 0, g: 0, b: 0 };
        lightVertexInto(normalMatrix[0] * nx + normalMatrix[4] * ny + normalMatrix[8] * nz,
            normalMatrix[1] * nx + normalMatrix[5] * ny + normalMatrix[9] * nz,
            normalMatrix[2] * nx + normalMatrix[6] * ny + normalMatrix[10] * nz,
            mesh.colors[i], mesh.colors[i + 1], mesh.colors[i + 2], vertex);
        vertices.push(vertex);
    }
    const kept: Triangle[] = [];
    let operations = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
        stats.input++;
        const pending: Triangle[] = [[vertices[mesh.indices[i]], vertices[mesh.indices[i + 1]], vertices[mesh.indices[i + 2]]]];
        while (pending.length) {
            if (++operations % 256 === 0) yield;
            const t = pending.pop()!, p = t.map(v => [v.x, v.y, v.z] as Vec3), proxy = proxyClass(p, ray), window = windowClass(p, def);
            if (proxy === 1 || window === 1) { stats.dropped++; continue; }
            if (proxy === -1 && window === -1) { kept.push(t); continue; }
            const edges = t.map((v, k) => projectedEdge(v, t[(k + 1) % 3])), longest = Math.max(...edges);
            if (longest <= 1) {
                stats.boundaryLeaves++; stats.maxBoundaryEdge = Math.max(stats.maxBoundaryEdge, longest);
                const centre = [0, 1, 2].map(k => (p[0][k] + p[1][k] + p[2][k]) / 3) as Vec3;
                if (!behindProxy(centre, ray) && !inFaceWindow(style, ...centre)) kept.push(t); else stats.dropped++;
            } else {
                stats.splits++;
                const a = edges.indexOf(longest), b = (a + 1) % 3, c = (a + 2) % 3, m = midpoint(t[a], t[b]);
                pending.push([t[a], m, t[c]], [m, t[b], t[c]]);
            }
        }
    }
    stats.kept = kept.length;
    return yield* sortTriangles(kept);
}
