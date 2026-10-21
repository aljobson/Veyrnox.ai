import { BAND_HEIGHT, STEP, TILE_CURVE, centredIndex, offsetsFor, stackOrder, tileShape } from '../src/lib/templateCollage';

describe('template collage layout', () => {
    test('tiles are wider than one swipe step, so neighbours overlap', () => {
        for (let i = 0; i < 12; i++) {
            expect(tileShape(i, false).width).toBeGreaterThan(STEP);
            expect(tileShape(i, true).width).toBeGreaterThan(STEP);
        }
    });

    test('a video is always taller than any image tile', () => {
        const tallestImage = Math.max(...[0, 1, 2].map((i) => tileShape(i, false).height));
        for (let i = 0; i < 9; i++) expect(tileShape(i, true).height).toBeGreaterThan(tallestImage);
    });

    test('every tile fits inside the band', () => {
        for (let i = 0; i < 12; i++) {
            for (const tall of [false, true]) {
                const s = tileShape(i, tall);
                expect(s.top).toBeGreaterThanOrEqual(0);
                expect(s.top + s.height).toBeLessThanOrEqual(BAND_HEIGHT);
            }
        }
    });

    test('the shapes repeat in a cycle and never run out', () => {
        expect(tileShape(0, false)).toEqual(tileShape(3, false));
        expect(tileShape(-1, false)).toEqual(tileShape(2, false));
    });

    test('the middle tile is full size, facing you and opaque; the sides shrink, fade and turn away', () => {
        const mid = TILE_CURVE.distances.indexOf(0);
        expect(TILE_CURVE.scale[mid]).toBe(1);
        expect(TILE_CURVE.opacity[mid]).toBe(1);
        expect(TILE_CURVE.turnDeg[mid]).toBe(0);
        expect(TILE_CURVE.lift[mid]).toBe(0);
        TILE_CURVE.distances.forEach((d, i) => {
            if (d === 0) return;
            expect(TILE_CURVE.scale[i]).toBeLessThan(1);
            expect(TILE_CURVE.opacity[i]).toBeLessThan(1);
        });
        // The two sides turn opposite ways.
        expect(Math.sign(TILE_CURVE.turnDeg[0])).toBe(-Math.sign(TILE_CURVE.turnDeg[4]));
    });

    test('scroll offsets for a tile rise in order and put it in the middle at index * step', () => {
        const at = offsetsFor(5);
        expect([...at].sort((a, b) => a - b)).toEqual(at);
        expect(at[TILE_CURVE.distances.indexOf(0)]).toBe(5 * STEP);
    });

    test('the centred tile follows the scroll offset and stays inside the list', () => {
        expect(centredIndex(0, 10)).toBe(0);
        expect(centredIndex(STEP * 3 + 10, 10)).toBe(3);
        expect(centredIndex(STEP * 3 + STEP * 0.6, 10)).toBe(4);
        expect(centredIndex(-50, 10)).toBe(0);
        expect(centredIndex(STEP * 99, 10)).toBe(9);
        expect(centredIndex(100, 0)).toBe(0);
    });

    test('the centred tile draws on top, then its neighbours', () => {
        expect(stackOrder(4, 4)).toBeGreaterThan(stackOrder(5, 4));
        expect(stackOrder(5, 4)).toBeGreaterThan(stackOrder(6, 4));
        expect(stackOrder(3, 4)).toBe(stackOrder(5, 4));
    });
});
