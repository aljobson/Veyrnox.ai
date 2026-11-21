import { curveValue } from '../../../../app/veyrnox/_lib/editorColour.mjs';
export type CurvePoint = { x: number; y: number };
const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export function movePoint(points: readonly CurvePoint[], i: number, x: number, y: number): CurvePoint[] {
    if (!points[i] || !Number.isFinite(x) || !Number.isFinite(y)) return [...points];
    let nextX = i === 0 ? 0 : i === points.length - 1 ? 1 : points[i].x;
    if (i > 0 && i < points.length - 1 && x !== points[i].x) {
        const lo = Math.ceil((points[i - 1].x + .001) * 1000) / 1000;
        const hi = Math.floor((points[i + 1].x - .001) * 1000) / 1000;
        if (lo <= hi) nextX = clamp(round(x), lo, hi);
    }
    return points.map((p, index) => index === i ? { x: nextX, y: y === points[i].y ? y : round(clamp(y)) } : p);
}
export function addPoint(points: readonly CurvePoint[]): CurvePoint[] {
    if (points.length >= 8) return [...points];
    let at = 0;
    for (let i = 1; i < points.length - 1; i++) if (points[i + 1].x - points[i].x > points[at + 1].x - points[at].x) at = i;
    const middle = (points[at].x + points[at + 1].x) / 2, x = round(middle);
    return [...points.slice(0, at + 1), { x, y: round(curveValue(points, middle)) }, ...points.slice(at + 1)];
}
export const removePoint = (points: readonly CurvePoint[], i: number): CurvePoint[] =>
    i > 0 && i < points.length - 1 ? points.filter((_, index) => index !== i) : [...points];
export const toView = (p: CurvePoint, w: number, h: number): CurvePoint => ({ x: p.x * w, y: (1 - p.y) * h });
export const fromView = (p: CurvePoint, w: number, h: number): CurvePoint => ({ x: p.x / w, y: 1 - p.y / h });
export function nearestPoint(points: readonly CurvePoint[], x: number, y: number, w: number, h: number, radius = 22): number {
    let nearest = -1, distance = radius;
    points.forEach((p, i) => { const v = toView(p, w, h), d = Math.hypot(v.x - x, v.y - y);
        if (d <= distance) { nearest = i; distance = d; } });
    return nearest;
}
export function segment(a: CurvePoint, b: CurvePoint, w: number, h: number) {
    const av = toView(a, w, h), bv = toView(b, w, h), width = Math.hypot(bv.x - av.x, bv.y - av.y);
    return { left: (av.x + bv.x - width) / 2, top: (av.y + bv.y) / 2, width, angle: Math.atan2(bv.y - av.y, bv.x - av.x) * 180 / Math.PI };
}
