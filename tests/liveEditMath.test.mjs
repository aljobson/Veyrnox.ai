import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import * as web from '../packages/live-edit/looks.js';
import { DEFAULTS, normalize, colorMatrix, toneLut, createHistory } from '../packages/live-edit/effects.js';
import { createLandmarkFilter } from '../packages/live-edit/smoothing.js';
import * as regions from '../packages/live-edit/regions.js';
import { STICKERS, anchoredSticker } from '../packages/live-edit/stickers.js';
const mobileSource = await readFile(new URL('../apps/mobile/src/lib/instantLooks.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(mobileSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const mobile = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);
test('all nine looks match the unchanged mobile implementation at every strength', () => {
    assert.deepEqual(web.LOOK_IDS, mobile.LOOK_IDS);
    for (const id of web.LOOK_IDS) for (const strength of [-1, 0, 0.1, 0.5, 0.8, 1, 2, NaN]) assert.deepEqual(web.lookMatrix({ id, strength }), mobile.lookMatrix({ id, strength }));
});
test('zero adjustments are identity; brightness and contrast have independent reference values', () => {
    assert.deepEqual(colorMatrix(DEFAULTS), web.IDENTITY);
    const brightness = colorMatrix({ ...DEFAULTS, brightness: 1 });
    assert.equal(brightness[4], 0.5); assert.equal(brightness[9], 0.5); assert.equal(brightness[14], 0.5);
    const contrast = colorMatrix({ ...DEFAULTS, contrast: 1 });
    assert.equal(contrast[0], 2); assert.equal(contrast[4], -0.5);
    assert.equal(normalize({ warmth: Infinity }).warmth, 0);
    assert.deepEqual(web.lookMatrix({ id: 'vivid', strength: 0 }), web.IDENTITY);
    for (const kind of ['none', 'film', 'print']) {
        const lut = toneLut(kind); assert.equal(lut.length, 1024);
        for (let i = 4; i < lut.length; i += 4) for (let c = 0; c < 3; c++) assert.ok(lut[i+c] >= lut[i-4+c]);
    }
});
test('history supports undo/redo, forks after undo, copies stickers and bounds memory', () => {
    const history = createHistory(); history.set({ ...DEFAULTS, brightness: 0.2 }); history.set({ ...history.value, brightness: 0.4 });
    history.undo(); assert.equal(history.value.brightness, 0.2); history.redo(); assert.equal(history.value.brightness, 0.4);
    history.undo(); history.set({ ...history.value, grain: 0.3 }); assert.equal(history.canRedo, false);
    const value = history.value; value.stickers.push({ kind: 'heart' }); assert.equal(history.value.stickers.length, 0);
    for (let i = 0; i < 200; i++) history.set({ ...DEFAULTS, brightness: i / 200 });
    let undos = 0; while (history.canUndo) { history.undo(); undos++; } assert.equal(undos, 100);
});
test('polygon edges are from the installed pinned MediaPipe SDK, including the inner lip', () => {
    for (const [table, sdk] of [['OVAL','FACE_OVAL'], ['LEFT_EYE','LEFT_EYE'], ['RIGHT_EYE','RIGHT_EYE'], ['LIPS','LIPS'], ['INNER_LIPS','LIPS']]) {
        const connections = FaceLandmarker[`FACE_LANDMARKS_${sdk}`]; const indices = regions[table];
        for (let i = 0; i < indices.length; i++) {
            const a = indices[i], b = indices[(i + 1) % indices.length];
            assert.ok(connections.some(edge => (edge.start === a && edge.end === b) || (edge.start === b && edge.end === a)), `${table} edge ${a} to ${b}`);
        }
    }
    assert.deepEqual(regions.polygonFromLandmarks(new Float32Array(), regions.OVAL), []);
});
test('filter reduces jitter, resets after lost face/gaps; stickers follow normalized anchors', async () => {
    const filter = createLandmarkFilter(); filter.update(new Float32Array([0, 0, 0]), 0);
    const moved = filter.update(new Float32Array([1, 1, 1]), 16); assert.ok(moved[0] > 0 && moved[0] < 1);
    filter.update(null, 32); assert.deepEqual(filter.update(new Float32Array([1, 1, 1]), 48), new Float32Array([1, 1, 1]));
    assert.deepEqual(filter.update(new Float32Array([2, 2, 2]), 1000), new Float32Array([2, 2, 2]));
    for (const [kind, shape] of Object.entries(STICKERS)) {
        const points = new Float32Array(478 * 3); points[shape.anchor * 3] = 0.25; points[shape.anchor * 3 + 1] = 0.5;
        assert.deepEqual(anchoredSticker(kind, points), { kind, x: 0.25, y: 0.5, size: 0.12 });
        assert.equal(anchoredSticker(kind, null), null);
        const svg = await readFile(new URL(`../public/photo-studio/stickers/${kind}.svg`, import.meta.url), 'utf8');
        assert.ok(svg.includes(shape.path)); assert.doesNotMatch(svg, /script|href|image/);
    }
});
