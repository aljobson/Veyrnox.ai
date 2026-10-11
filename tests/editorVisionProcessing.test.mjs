import test from 'node:test';
import assert from 'node:assert/strict';
import { personFraming, processVisionPixels, validateVisionSettings } from '../app/veyrnox/_lib/editorVisionPixelProcessing.mjs';
import { editorVisionWorkerPolicy, EDITOR_VISION_PATH } from '../app/veyrnox/_lib/editorVisionRuntime.mjs';
function masks() { const width = 24, height = 16, background = new Float32Array(width * height).fill(1), face = new Float32Array(width * height), body = new Float32Array(width * height); for (let y = 4; y < 12; y++) for (let x = 8; x < 16; x++) { background[y * width + x] = 0; face[y * width + x] = y < 8 ? 1 : 0; body[y * width + x] = y >= 8 ? 1 : 0; } return { width, height, background, face, body }; }
function picture() { const data = new Uint8ClampedArray(24 * 16 * 4); for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) data.set([130 + ((x + y) % 2 ? 10 : -10), 100, 80, 255], (y * 24 + x) * 4); return { width: 24, height: 16, data }; }
test('background replacement respects a semantic person mask and does not alter its retained foreground', () => { const source = picture(), out = processVisionPixels(source, masks(), { tool: 'replace-background', colour: [12, 34, 56] }); assert.deepEqual([...out.data.slice(0, 4)], [12, 34, 56, 255]); const p = (6 * 24 + 10) * 4; assert.deepEqual(out.data.slice(p, p + 4), source.data.slice(p, p + 4)); assert.equal(source.data[0], 120); });
test('skin retouch reduces local face texture while preserving background and unselected body pixels', () => { const source = picture(), out = processVisionPixels(source, masks(), { tool: 'skin-retouch', region: 'face', strength: 1 }); const p = (6 * 24 + 10) * 4, body = (10 * 24 + 10) * 4; assert.ok(out.data[p] > source.data[p]); assert.equal(out.data[body], source.data[body]); assert.equal(out.data[0], source.data[0]); const zero = processVisionPixels(source, masks(), { tool: 'skin-retouch', strength: 0 }); assert.deepEqual(zero.data, source.data); });
test('person framing finds the actual connected silhouette and reports no person when no mask supports one', () => { const found = personFraming(masks()); assert.equal(found.found, true); assert.equal(found.x, .5); assert.equal(found.y, .5); assert.equal(found.area, 64 / 384); assert.equal(found.regions, 1); const blank = masks(); blank.background.fill(1); assert.equal(personFraming(blank).found, false); });
test('portrait framing anchors a confident face within the selected person, with a whole-person fallback for weak face evidence', () => {
    const mask = masks(); mask.face.fill(0);
    for (let y = 4; y < 8; y++) for (let x = 8; x < 12; x++) mask.face[y * 24 + x] = .9;
    const framed = personFraming(mask);
    assert.equal(framed.anchor, 'face'); assert.ok(Math.abs(framed.x - 10 / 24) < 1e-7);
    assert.equal(framed.y, .5, 'vertical framing still follows the selected person region');
    mask.face.fill(.4);
    const fallback = personFraming(mask); assert.equal(fallback.anchor, 'person'); assert.equal(fallback.x, .5);
    mask.face.fill(0); mask.face[4 * 24 + 8] = 1;
    assert.equal(personFraming(mask).anchor, 'person', 'one confident pixel cannot move a crop');
});
test('body glow follows the person boundary without recolouring its face', () => { const source = picture(), out = processVisionPixels(source, masks(), { tool: 'person-glow', colour: [0, 255, 0] }); const face = (6 * 24 + 10) * 4, edge = (6 * 24 + 6) * 4; assert.deepEqual(out.data.slice(face, face + 4), source.data.slice(face, face + 4)); assert.ok(out.data[edge + 1] > source.data[edge + 1]); });
test('the worker permission is scoped to its exact immutable origin prefix and excludes nested workers', () => { const policy = editorVisionWorkerPolicy('https://veyrnox.ai'); assert.ok(policy.includes(`script-src https://veyrnox.ai${EDITOR_VISION_PATH}/ 'wasm-unsafe-eval'`)); assert.ok(policy.includes("worker-src 'none'")); assert.ok(!policy.includes("'unsafe-eval'")); for (const origin of ['https://user:password@veyrnox.ai', 'https://veyrnox.ai/other', 'data:test']) assert.throws(() => editorVisionWorkerPolicy(origin)); });
test('bad mask shapes, processing colours and strengths are rejected before image allocation', () => { assert.throws(() => processVisionPixels(picture(), { ...masks(), width: 1e9 }, { tool: 'skin-retouch' })); for (const settings of [{ tool: 'skin-retouch', strength: 5 }, { tool: 'replace-background', colour: [1000, 0, 0] }, { tool: 'skin-retouch', region: 'identity' }]) assert.ok(validateVisionSettings(settings)); });

test('person-video preprocessing refuses invalid media and cancellation before loading a model', async () => {
    const { processVisionVideo } = await import('../app/veyrnox/_lib/editorVisionVideo.mjs');
    await assert.rejects(() => processVisionVideo(new Blob(['bad'], { type: 'text/plain' }), { tool: 'replace-background' }), /MP4/);
    const input = new Blob(['video'], { type: 'video/mp4' }), controller = new AbortController(); controller.abort();
    await assert.rejects(() => processVisionVideo(input, { tool: 'person-reframe', aspect: 9 / 16, signal: controller.signal }), error => error.name === 'AbortError');
    await assert.rejects(() => processVisionVideo(input, { tool: 'skin-retouch', onProgress: 'invalid' }), /callback/);
});

test('person cutout keeps original colour and fractional source alpha while removing only semantic background', () => {
    const source = picture(), mask = masks(), edge = (6 * 24 + 10) * 4; source.data[edge + 3] = 128;
    mask.background[6 * 24 + 10] = .5;
    const out = processVisionPixels(source, mask, { tool: 'remove-background' });
    assert.equal(out.data[3], 0); assert.deepEqual(out.data.slice(0, 3), source.data.slice(0, 3));
    assert.equal(out.data[edge + 3], 64); assert.equal(source.data[edge + 3], 128);
    const zero = processVisionPixels(source, mask, { tool: 'remove-background', strength: 0 }); assert.deepEqual(zero.data, source.data);
});

test('transparent encoding refuses odd, excessive or cancelled work before allocating native encoders', async () => {
    const { createAlphaCanvasSource } = await import('../app/veyrnox/_lib/editorAlphaVideo.mjs');
    for (const canvas of [{ width: 127, height: 64 }, { width: 1920, height: 1080 }]) await assert.rejects(() => createAlphaCanvasSource({}, {}, canvas), /bounded even dimensions/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => createAlphaCanvasSource({}, {}, { width: 128, height: 64 }, { signal: controller.signal }), error => error.name === 'AbortError');
});


test('confidence matting removes a background probability floor, keeps opaque skin and retains smooth uncertain edges', () => {
    const source = picture(), mask = masks();
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) mask.background[y * mask.width + x] = x < 4 ? .92 : x < 8 ? .7 : x < 12 ? .5 : x < 16 ? .3 : .02;
    const cutout = processVisionPixels(source, mask, { tool: 'remove-background' }), replacement = processVisionPixels(source, mask, { tool: 'replace-background', colour: [10, 210, 180] });
    const alpha = x => cutout.data[(8 * 24 + x) * 4 + 3];
    assert.equal(alpha(1), 0); assert.equal(alpha(20), 255);
    assert.ok(alpha(5) > 0 && alpha(5) < alpha(10)); assert.equal(alpha(10), 128);
    assert.ok(alpha(14) > alpha(10) && alpha(14) < 255);
    assert.deepEqual([...replacement.data.slice((8 * 24 + 1) * 4, (8 * 24 + 1) * 4 + 3)], [10, 210, 180]);
    assert.deepEqual(replacement.data.slice((8 * 24 + 20) * 4, (8 * 24 + 20) * 4 + 4), source.data.slice((8 * 24 + 20) * 4, (8 * 24 + 20) * 4 + 4));
});
