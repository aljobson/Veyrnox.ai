/* eslint-disable @typescript-eslint/no-require-imports -- exact generated shared tables */
import { SKIN_SMOOTHING as S } from './smoothing';
import type { MakeupId, Stack } from './engine';
type Point = [number, number];
const R = require('./shared/regions') as Record<string, number[]>;
export type Shape = { vertices: Point[]; radial?: { center: Point; radius: number }; gradient?: [Point, Point] };
export type Region = { shapes: Shape[]; holes: Point[][] };
const mean = (v: Point[]): Point => v.reduce((a, p) => [a[0] + p[0] / v.length, a[1] + p[1] / v.length], [0, 0]);
export function regionFor(id: MakeupId | 'smoothing', points: Float32Array, settings: Stack, aspect = 1): Region {
    const poly = (key: string, expansion = 1): Point[] => {
        const vertices = R[key].map(i => [points[i * 3], points[i * 3 + 1] * aspect] as Point), c = mean(vertices);
        return vertices.map(p => [c[0] + (p[0] - c[0]) * expansion, c[1] + (p[1] - c[1]) * expansion]);
    };
    const shapes: Shape[] = [], faceCenter = mean(poly('OVAL'));
    const sides = ['LEFT', 'RIGHT'].map(side => {
        const e = poly(`${side}_EYE`), b = poly(`${side}_BROW`), u = poly(`${side}_UPPER_EYE`);
        const center = mean(e), brow = mean(b), up = [brow[0] - center[0], brow[1] - center[1]];
        return { e, b, u, center, brow, up, span: Math.hypot(u[0][0] - u[u.length - 1][0], u[0][1] - u[u.length - 1][1]) };
    });
    if (id === 'foundation' || id === 'smoothing') shapes.push({ vertices: poly('OVAL', id === 'smoothing' ? S.ovalScale : .94) });
    if (id === 'lips') {
        const lips = poly('LIPS'), inner = mean(poly('INNER_LIPS')), eyes = mean(sides.map(s => s.center));
        const axis = [inner[0] - eyes[0], inner[1] - eyes[1]], length = Math.hypot(...axis) || 1;
        const direction = axis.map(v => v / length), projections = lips.map(p => (p[0] - inner[0]) * direction[0] + (p[1] - inner[1]) * direction[1]);
        const at = (v: number): Point => [inner[0] + direction[0] * v, inner[1] + direction[1] * v];
        shapes.push({ vertices: lips, gradient: [at(Math.min(...projections)), at(Math.max(...projections))] });
    }
    for (const s of sides) {
        if (id === 'brows') shapes.push({ vertices: s.b });
        if (id === 'blush') shapes.push({ vertices: poly('OVAL', .92), radial: { center: s.center.map((v, i) => v - s.up[i] * 1.25 + (v - faceCenter[i]) * .12) as Point, radius: s.span * .8 } });
        if (id === 'eyeshadow') {
            const raised = s.u.map((p, i) => p.map((v, j) => v + s.up[j] * .65 * Math.sin(Math.PI * i / (s.u.length - 1))) as Point);
            shapes.push({ vertices: [...s.u, ...raised.reverse()], gradient: [s.center, s.center.map((v, i) => v + s.up[i] * .65) as Point] });
        }
        if (id === 'eyeliner') {
            const outer = s.u.map(p => p.map((v, j) => v + s.up[j] * .18) as Point);
            shapes.push({ vertices: [...s.u, ...outer.reverse()] });
            const corner = s.u[0], inner = s.u[s.u.length - 1], wing = settings.makeup.eyeliner.wing ?? .4;
            shapes.push({ vertices: [corner, corner.map((v, j) => v + (v - inner[j]) * wing * .5 + s.up[j] * wing * .4) as Point, corner.map((v, j) => v + s.up[j] * .25) as Point] });
        }
        if (id === 'lashes') {
            const volume = settings.makeup.lashes.volume ?? .5;
            s.u.slice(1, -1).forEach((p, i) => {
                const base = p.map((v, j) => v + s.up[j] * .08), tip = base.map((v, j) => v + s.up[j] * (.18 + volume * .45) + (p[j] - s.center[j]) * .12);
                const tangent = s.u[i + 2].map((v, j) => (v - s.u[i][j]) * (.05 + volume * .16));
                shapes.push({ vertices: [base.map((v, j) => v - tangent[j]) as Point, tip as Point, base.map((v, j) => v + tangent[j]) as Point] });
            });
        }
    }
    const holes = id === 'smoothing' ? [...S.maskExclusions] : id === 'lips' ? ['INNER_LIPS', 'LEFT_EYE', 'RIGHT_EYE'] : ['LIPS', 'LEFT_EYE', 'RIGHT_EYE'];
    if (['foundation', 'blush'].includes(id)) holes.push('LEFT_BROW', 'RIGHT_BROW');
    const normalized = (p: Point): Point => [p[0], p[1] / aspect];
    return { shapes: shapes.map(shape => ({ vertices: shape.vertices.map(normalized),
        ...(shape.gradient ? { gradient: shape.gradient.map(normalized) as [Point, Point] } : {}),
        ...(shape.radial ? { radial: { ...shape.radial, center: normalized(shape.radial.center) } } : {}),
    })), holes: holes.map(key => poly(key, id === 'smoothing' ? S.holeScale : 1).map(normalized)) };
}
