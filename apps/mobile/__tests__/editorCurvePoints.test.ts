import { movePoint, addPoint, removePoint, toView, fromView, nearestPoint, segment } from '../src/lib/editorCurvePoints';
import { colourDefaults, colourProblem, CURVE_CHANNELS, curveValue } from '../../../app/veyrnox/_lib/editorColour.mjs';
test('widest gap insertion matches the web and stops at eight', () => {
    let points = [{ x: 0, y: 0 }, { x: .2, y: .4 }, { x: 1, y: 1 }];
    expect(addPoint(points)).toEqual([points[0], points[1], { x: .6, y: Number(curveValue(points, .6).toFixed(3)) }, points[2]]);
    while (points.length < 8) points = addPoint(points);
    expect(addPoint(points)).toEqual(points);
});
test('seeded edits on every channel remain valid', () => {
    let seed = 17;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    for (const channel of CURVE_CHANNELS) {
        let points = colourDefaults().curves[channel];
        for (let n = 0; n < 2000; n++) {
            const i = Math.floor(random() * points.length), op = Math.floor(random() * 3);
            points = op === 0 ? movePoint(points, i, random() * 2 - .5, random() * 2 - .5)
                : op === 1 ? addPoint(points) : removePoint(points, i);
            expect(colourProblem({ ...colourDefaults(), curves: { ...colourDefaults().curves, [channel]: points } })).toBeNull();
            expect(points[0].x).toBe(0); expect(points[points.length - 1].x).toBe(1);
        }
    }
});
test('imported precision is preserved and tightly spaced x cannot cross neighbours', () => {
    const points = [{ x: 0, y: 0 }, { x: .0004, y: .1234567 }, { x: .0008, y: .7654321 }, { x: 1, y: 1 }];
    expect(movePoint(points, 1, .7, .55555)).toEqual([points[0], { x: .0004, y: .556 }, points[2], points[3]]);
    expect(removePoint(points, 0)).toEqual(points); expect(removePoint(points, 3)).toEqual(points);
    expect(addPoint(points).slice(0, 3)).toEqual(points.slice(0, 3));
});
test('view math uses exact lengths, inverted y, angle and nearest hit radius', () => {
    const a = { x: .1, y: .2 }, b = { x: .7, y: .8 }, av = toView(a, 200, 160), bv = toView(b, 200, 160);
    expect(fromView(av, 200, 160).x).toBeCloseTo(a.x); expect(fromView(av, 200, 160).y).toBeCloseTo(a.y);
    const line = segment(a, b, 200, 160);
    expect(line.width).toBeCloseTo(Math.hypot(bv.x - av.x, bv.y - av.y));
    expect(line.angle).toBeCloseTo(Math.atan2(bv.y - av.y, bv.x - av.x) * 180 / Math.PI);
    expect(nearestPoint([a, b], av.x, av.y, 200, 160)).toBe(0);
    expect(nearestPoint([a, b], 100, 80, 200, 160)).toBe(-1);
});
test('insertion samples the unrounded web midpoint before rounding the new point', () => {
    const points = [{ x: 0, y: 0 }, { x: .333, y: 0 }, { x: .666, y: 0 }, { x: 1, y: 1 }];
    expect(addPoint(points)).toEqual([...points.slice(0, 3), { x: .833, y: .5 }, points[3]]);
});
test('editing one axis leaves the other imported coordinate exact', () => {
    const points = [{ x: 0, y: 0 }, { x: .12345678, y: .456789 }, { x: 1, y: 1 }];
    expect(movePoint(points, 1, points[1].x, .6)[1]).toEqual({ x: .12345678, y: .6 });
    expect(movePoint(points, 1, .2, points[1].y)[1]).toEqual({ x: .2, y: .456789 });
});
