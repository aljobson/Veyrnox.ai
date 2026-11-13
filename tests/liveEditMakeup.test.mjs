import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import * as regions from '../packages/live-edit/regions.js';
import { MAKEUP, MAKEUP_DEFAULTS, MAKEUP_PRESETS, normalizeMakeup, blendChannel, blendColor } from '../packages/live-edit/makeup.js';
import { DEFAULTS, createHistory, normalize } from '../packages/live-edit/effects.js';
import messages from '../lib/i18n/photoStudioEnglish.mjs';
import { MAKEUP_GOLDENS } from './fixtures/photo-studio-makeup-goldens.mjs';

test('all S2 landmark indices and open/closed chains match installed SDK 1.0.1', async () => {
    const pkg = JSON.parse(await readFile(new URL('../node_modules/@mediapipe/tasks-vision/package.json', import.meta.url)));
    assert.equal(pkg.version, '1.0.1');
    for (const [table, sdk, closed] of [
        ['OVAL','FACE_OVAL',true], ['LIPS','LIPS',true], ['INNER_LIPS','LIPS',true],
        ['LEFT_EYE','LEFT_EYE',true], ['RIGHT_EYE','RIGHT_EYE',true],
        ['LEFT_UPPER_EYE','LEFT_EYE',false], ['RIGHT_UPPER_EYE','RIGHT_EYE',false],
        ['LEFT_BROW','LEFT_EYEBROW',false], ['RIGHT_BROW','RIGHT_EYEBROW',false],
    ]) {
        const edges = FaceLandmarker[`FACE_LANDMARKS_${sdk}`], indices = regions[table];
        const vertices = new Set(edges.flatMap(e => [e.start, e.end]));
        for (const index of indices) assert.ok(vertices.has(index), `${table}: ${index}`);
        for (let i = 0; i < indices.length - (closed ? 0 : 1); i++) {
            // Brow polygons bridge the SDK's two open chains at their endpoints.
            if (table.endsWith('BROW') && i === 4) continue;
            const a = indices[i], b = indices[(i + 1) % indices.length];
            assert.ok(edges.some(e => e.start === a && e.end === b || e.start === b && e.end === a), `${table}: ${a}-${b}`);
        }
        if (table.endsWith('BROW')) {
            const endpoints = [...vertices].filter(v => edges.filter(e => e.start === v || e.end === v).length === 1);
            assert.deepEqual(new Set([indices[0], indices[4], indices[5], indices[9]]), new Set(endpoints));
        }
    }
});
test('CPU blend references cover multiply, screen and every soft-light branch', () => {
    for (const [b,s,mode,expected] of [
        [.4,.25,'multiply',.1], [.4,.25,'screen',.55],
        [.4,.25,'soft-light',.28], [.16,.75,'soft-light',.279168],
        [.36,.75,'soft-light',.48], [.4,.5,'soft-light',.4],
    ]) assert.ok(Math.abs(blendChannel(b,s,mode) - expected) < 1e-10);
    const base = [.16,.36,.64], pigment = [.75,.75,.25];
    assert.deepEqual(blendColor(base, pigment, 'soft-light', 0), base);
    blendColor(base, pigment, 'multiply', 1).forEach((v,i) => assert.ok(Math.abs(v - [.12,.27,.16][i]) < 1e-12));
    const half = blendColor(base, pigment, 'screen', .5);
    half.forEach((v,i) => assert.ok(Math.abs(v - (base[i] + blendChannel(base[i],pigment[i],'screen')) / 2) < 1e-12));
});
test('makeup defaults, invalid inputs, presets and history preserve independent bounded values', () => {
    assert.deepEqual(normalize(DEFAULTS).makeup, MAKEUP_DEFAULTS);
    const bad = normalizeMakeup({ lips: { strength: NaN, shade: 'bogus', finish: 'bogus' }, eyeliner: { strength: 2, wing: -1 }, lashes: { volume: Infinity } });
    assert.equal(bad.lips.strength, 0); assert.equal(bad.lips.finish, 'matte');
    assert.equal(bad.eyeliner.strength, 1); assert.equal(bad.eyeliner.wing, 0); assert.equal(bad.lashes.volume, 0);
    const history = createHistory(); history.set({ ...history.value, makeup: MAKEUP_PRESETS.glam });
    const value = history.value; value.makeup.lips.strength = 0;
    assert.equal(history.value.makeup.lips.strength, .7);
    history.undo(); assert.deepEqual(history.value.makeup, MAKEUP_DEFAULTS);
    history.redo(); assert.deepEqual(history.value.makeup, MAKEUP_PRESETS.glam);
    for (const d of MAKEUP) {
        assert.ok(messages[`app.photoStudio.makeup.${d.id}`]);
        for (const shade of d.shades) assert.ok(messages[`app.photoStudio.makeup.${shade}`]);
        assert.equal(d.face, true); assert.equal(d.defaultStrength, 0);
    }
});

test('engine clears makeup landmarks for no face/multiple faces and retains makeup in export', async () => {
    const { createPhotoEngine } = await import('../app/veyrnox/_lib/liveEdit/engine.js');
    const oldRAF = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
    try {
        for (const count of [0,1,2]) {
            const points = new Float32Array(1434).fill(.5), seen = [], drawn = [];
            const engine = createPhotoEngine({ toBlob: cb => cb(new Blob(['test'])) }, {}, {
                rendererFactory: () => ({ setLandmarks: p => seen.push(p), draw: s => drawn.push(s), close() {} }),
                processorFactory: async () => ({ detect: async () => ({ count, landmarks: points }), close() {} }),
            });
            try {
                await engine.ready; assert.equal(seen.at(-1).length, count === 1 ? 1434 : 0);
                engine.setSettings({ ...DEFAULTS, makeup: MAKEUP_PRESETS.glam }); engine.compare(true);
                await engine.export(); assert.deepEqual(drawn.at(-1).makeup, MAKEUP_PRESETS.glam);
            } finally { engine.close(); }
        }
    } finally { globalThis.requestAnimationFrame = oldRAF; globalThis.cancelAnimationFrame = oldCancel; }
});


test('gloss tail crop has an analytic constant value despite one-byte gradient rounding', () => {
    const golden = MAKEUP_GOLDENS.find(crop => crop.name === 'lip-gloss');
    assert.deepEqual([golden.x, golden.y], [127, 196]);
    const base = [128,96,64], pigment = [173,56,92];
    const unlit = base.map((b,i) => .6 * b * pigment[i] / 255 + .4 * pigment[i]);
    assert.deepEqual(unlit.map(Math.round), [121,35,51]);
    assert.deepEqual(golden.rgb, Array.from({ length: 9 }, () => [121,35,51]).flat());
    // Fixture lip bounds are y=.65..79; evaluate pixel centres, including +/-1 RGB8 step.
    for (let y = 196; y <= 198; y++) for (const quantization of [-1,0,1]) {
        const g = Math.round(((y + .5) / 256 - .65) / .14 * 255) / 255 + quantization / 255;
        const highlight = Math.pow(Math.max(0, 1 - Math.abs(g - .68) / .22), 8) * .55;
        assert.ok(highlight * 255 < .01);
        assert.deepEqual(unlit.map(b => Math.round(b + (255 - b) * highlight)), [121,35,51]);
    }
});
