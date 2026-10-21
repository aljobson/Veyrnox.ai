import { adjustBox, canDraw, drawReducer, exportSize, fitRect, POINT_LIMIT, pointCount, strokeWidthPx, toImagePoint, type Box, type DrawOp } from '../src/lib/drawOnImage';
import { scaledSize } from '../src/lib/chatAttach';
import type { CatalogModel } from '../src/lib/media';
import { slotsFor } from '../src/lib/sources';
const model: CatalogModel = { id: 'fal-ai/nano-banana-pro/edit', name: 'Edit', modality: 'image-to-image', credits: 1, gated: false, durations: [], capabilities: { inputs: { prompt: {} }, media: { image: {} } } };

test('eligibility needs an image model, image slot and prompt', () => {
    expect(canDraw(model)).toBe(true);
    expect(canDraw({ ...model, capabilities: { media: { image: {} } } })).toBe(false);
    expect(canDraw({ ...model, capabilities: { inputs: { prompt: {} } } })).toBe(false);
    expect(canDraw({ ...model, modality: 'image-to-video' })).toBe(false);
    expect(canDraw({ ...model, capabilities: { inputs: { topic: {} }, media: { image: {} } } })).toBe(false);
});
test('contain fitting and touches account for letterboxing and clamp outside points', () => {
    const fit = fitRect({ width: 390, height: 600 }, { width: 4032, height: 3024 });
    expect(fit).toMatchObject({ x: 0, y: 153.75, width: 390, height: 292.5 });
    expect(toImagePoint({ x: 195, y: 300 }, fit)).toEqual({ x: 2016, y: 1512 });
    expect(toImagePoint({ x: -20, y: 0 }, fit)).toEqual({ x: 0, y: 0 });
    expect(toImagePoint({ x: 800, y: 900 }, fit)).toEqual({ x: 4032, y: 3024 });
    expect(strokeWidthPx(8, fit.scale)).toBeCloseTo(82.70769);
});
test('native edge cap precedes optional integer maxPixels scaling', () => {
    const resized = scaledSize(4032, 3024);
    expect(exportSize(resized.width, resized.height)).toEqual({ width: 2048, height: 1536 });
    expect(exportSize(3000, 2000, 6_000_000)).toEqual({ width: 3000, height: 2000 });
    const target = exportSize(4000, 3000, 6_000_000);
    expect(target.width * target.height).toBeLessThanOrEqual(6_000_000);
    expect(target.width / target.height).toBeCloseTo(4 / 3, 2);
    expect(slotsFor({ ...model, capabilities: { media: { image: { maxPixels: 1234 } } } } as CatalogModel)[0].maxPixels).toBe(1234);
});
test('ops are immutable, tap is retained, moves thin at one pixel and total points cap at 20,000', () => {
    const empty = Object.freeze([]);
    const first = drawReducer(empty, { type: 'addStroke', stroke: { kind: 'pen', color: 'red', width: 8, points: [{ x: 0, y: 0 }] } });
    expect(empty).toEqual([]);
    expect(drawReducer(first, { type: 'extendStroke', point: { x: 0.5, y: 0 } })).toBe(first);
    expect(pointCount(drawReducer(first, { type: 'extendStroke', point: { x: 1, y: 0 } }))).toBe(2);
    const full = drawReducer(first, { type: 'addStroke', stroke: { kind: 'erase', color: 'red', width: 8, points: Array.from({ length: POINT_LIMIT + 5 }, (_, x) => ({ x, y: 1 })) } });
    expect(pointCount(full)).toBe(POINT_LIMIT);
    expect(drawReducer(full, { type: 'extendStroke', point: { x: 90000, y: 0 } })).toBe(full);
    expect(drawReducer(full, { type: 'addStroke', stroke: { kind: 'pen', color: 'red', width: 1, points: [{ x: 0, y: 0 }] } })).toBe(full);
    expect(drawReducer(first, { type: 'undo' })).toEqual([]);
    expect(drawReducer(first, { type: 'clear' })).not.toBe(first);
    expect(drawReducer(empty, { type: 'undo' })).not.toBe(empty);
});
test('accessible box resizing and movement stay inside the photo', () => {
    const box: Box = { kind: 'box', x: 25, y: 25, width: 50, height: 50, color: 'red', strokeWidth: 4 };
    const grown = adjustBox(box, 'increment', { width: 100, height: 100 });
    expect(grown).toMatchObject({ x: 20, y: 20, width: 60, height: 60 });
    let ops: readonly DrawOp[] = drawReducer([], { type: 'addBox', box });
    for (let i = 0; i < 30; i++) ops = drawReducer(ops, { type: 'adjustBox', index: 0, action: 'moveLeft', image: { width: 100, height: 100 } });
    expect(ops[0]).toMatchObject({ x: 0, y: 25 });
    let large = grown;
    for (let i = 0; i < 30; i++) large = adjustBox(large, 'increment', { width: 100, height: 100 });
    expect(large).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(box.x).toBe(25);
});
