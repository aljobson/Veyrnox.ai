import test from 'node:test';
import assert from 'node:assert/strict';
import * as cutout from '../lib/templateSwapCutout.mjs';
import { checkTemplateSwapImages } from '../lib/templateSwapClipGeneration.js';
const mask = (width, height, inside) => ({ width, height, data: Float32Array.from({ length: width * height }, (_, i) => +inside(i % width, Math.floor(i / width))) });
const rect = (w = 256) => mask(w, w, (x, y) => x >= w / 4 && x < 3 * w / 4 && y >= w / 4 && y < 3 * w / 4);

test('named smoothstep removes background ghosts before resampling; multiclass fallback clamps', () => {
  assert.equal(cutout.MATTE_SMOOTHSTEP_LOW, 0.4); assert.equal(cutout.MATTE_SMOOTHSTEP_HIGH, 0.6);
  const alpha = cutout.personAlpha({ width: 5, height: 1, background: [1, .7, .5, .3, 0] });
  assert.deepEqual([...alpha.data], [0, 0, .5, 1, 1]);
  const channels = cutout.personAlpha({ width: 3, height: 1, body: [.1, .2, 1], face: [.1, .1, 0], hair: [0, .1, 0], clothes: [0, .1, .5] });
  assert.deepEqual([...channels.data], [0, .5, 1]);
  assert.throws(() => cutout.personAlpha({ width: 2, height: 1, background: [NaN, 0] }), /invalid_mask/);
  const scaled = cutout.resampleAlpha(mask(2, 2, x => x === 1), { width: 10, height: 10 }, 0);
  assert.equal(scaled.data[0], 0); assert.equal(scaled.data[9], 1);
  assert.ok(scaled.data[4] > 0 && scaled.data[4] < 1);
  const feathered = cutout.resampleAlpha(rect(16), { width: 64, height: 64 });
  assert.ok(feathered.data.some(v => v > 0 && v < 1));
});

test('coverage rejects empty, tiny and full frame; a plain wall silhouette passes', () => {
  for (const m of [mask(32, 32, () => false), mask(32, 32, (x, y) => x < 2 && y < 2), mask(32, 32, () => true)]) assert.equal(cutout.coverageOk(m).ok, false);
  assert.equal(cutout.coverageOk(rect()).ok, true);
  const portrait = mask(256, 256, (x, y) => ((x - 128) / 50) ** 2 + ((y - 135) / 105) ** 2 < 1);
  assert.equal(cutout.matteQuality(portrait).ok, true);
});

test('stray component thresholds and second person block; face count is separate', () => {
  assert.equal(cutout.MATTE_MAX_STRAY_COMPONENT, .01); assert.equal(cutout.MATTE_MAX_STRAY_TOTAL, .02);
  const busy = mask(256, 256, (x, y) => (x >= 70 && x < 180 && y >= 40 && y < 220) || (x > 200 && x < 230 && y > 100 && y < 200) || (x < 10 && y < 10));
  assert.equal(cutout.coverageOk(busy).error, 'busy_background');
  // Each 10x10 fragment is <1% of the 128x128 main blob, together >2%.
  const fragments = mask(256, 256, (x, y) => (x >= 64 && x < 192 && y >= 64 && y < 192) || (y < 10 && x < 80 && x % 20 < 10));
  assert.equal(cutout.matteQuality(fragments).error, 'busy_background');
});

test('raggedness uses filled outer boundary / convex hull and is resolution independent', () => {
  assert.equal(cutout.MATTE_MAX_RAGGEDNESS, 1.55); assert.equal(cutout.MATTE_GRID_SIZE, 256);
  for (const w of [128, 256, 384]) {
    const smooth = rect(w), quality = cutout.matteQuality(smooth);
    assert.equal(quality.ok, true); assert.ok(Math.abs(quality.raggedness - 1) < .02);
    const holes = mask(w, w, (x, y) => smooth.data[y * w + x] && !(x > .4 * w && x < .6 * w && y > .4 * w && y < .6 * w));
    assert.equal(cutout.matteQuality(holes).raggedness, quality.raggedness);
    const comb = mask(w, w, (x, y) => x >= w / 4 && x < 3 * w / 4 && y >= w / 4 && y < 3 * w / 4 && (x < w / 2 || Math.floor(y * 32 / w) % 2 === 0));
    assert.equal(cutout.coverageOk(comb).error, 'ragged_matte');
  }
});

test('exactly one face, including touching shoulders, poster and small background faces', () => {
  const size = { width: 1000, height: 1000 }, face = { x: 300, y: 200, width: 200, height: 250 };
  assert.equal(cutout.checkFaces([], size).error, 'no_face');
  assert.deepEqual(cutout.checkFaces([face], size), { ok: true, faceBox: face });
  for (const secondary of [face, { ...face, width: 100, height: 100 }, { ...face, width: 10, height: 10 }]) {
    assert.equal(cutout.checkFaces([face, secondary], size).error, 'several_people');
  }
  assert.equal(cutout.checkFaces([{ ...face, width: 49 }], size).error, 'face_too_small');
  assert.equal(cutout.checkFaces([{ ...face, width: 50 }], size).ok, true);
  // Profile orientation does not override a detector's accepted single box.
  assert.equal(cutout.checkFaces([{ ...face, width: 80 }], size).ok, true);
});

test('crop bounds, body extent, padding and output dimensions remain admissible', () => {
  for (const size of [{ width: 1000, height: 1000 }, { width: 600, height: 2400 }, { width: 2400, height: 600 }]) {
    for (const face of [{ x: 0, y: 0, width: 120, height: 160 }, { x: 240, y: 240, width: 150, height: 150 }]) {
      const result = cutout.headShouldersBox(face, { x: 0, y: 0, ...size }, size);
      assert.equal(result.ok, true);
      const b = result.box;
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= size.width && b.y + b.height <= size.height);
      assert.ok(b.width / b.height >= .75 && b.width / b.height <= 1.33);
      assert.ok(Math.min(result.output.width, result.output.height) >= 512);
    }
  }
  assert.equal(cutout.headShouldersBox({ x: 10, y: 10, width: 30, height: 30 }, null, { width: 100, height: 100 }).ok, false);
  const face = { x: 400, y: 200, width: 100, height: 100 }, size = { width: 1000, height: 1000 };
  assert.notDeepEqual(cutout.headShouldersBox(face, { x: 100, y: 200, width: 300, height: 160 }, size).box, cutout.headShouldersBox(face, null, size).box);
});

test('output caps and client size/aspect mirror agree with server', () => {
  assert.deepEqual(cutout.outputSize({ width: 6000, height: 4000 }), { ok: true, width: 1536, height: 1024 });
  assert.deepEqual(cutout.outputSize({ width: 6000, height: 4000 }, 'crop'), { ok: true, width: 1024, height: 683 });
  for (const kind of ['frontal', 'crop']) for (const [width, height] of [[300, 300], [299, 300], [400, 1000], [399, 1000], [1000, 400], [1536, 1024], [1537, 1024], [1025, 800]]) {
    const image = { contentType: 'image/png', dimensions: { width, height } }, normal = { contentType: 'image/png', dimensions: { width: 600, height: 600 } };
    const sources = { image_url: kind === 'frontal' ? [image, normal] : [normal, image] };
    assert.equal(cutout.checkOutputSize({ width, height }, kind).ok, checkTemplateSwapImages(sources).ok);
  }
});

test('bounded rotation and scale map boxes back to original pixels', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const transform = cutout.inputTransform({ width: 6000, height: 4000 }, rotation);
    assert.equal(transform.ok, true); assert.equal(Math.max(transform.width, transform.height), 1536);
    const original = { x: 100, y: 200, width: 300, height: 400 };
    const mapped = cutout.mapBox(original, transform, 'toInput');
    const restored = cutout.mapBox(mapped, transform, 'toOriginal');
    for (const key of Object.keys(original)) assert.ok(Math.abs(restored[key] - original[key]) < 1e-8);
  }
  assert.deepEqual(cutout.mapPoint({ x: 0, y: 0 }, cutout.inputTransform({ width: 6000, height: 4000 }, 90), 'toInput'), { x: 1024, y: 0 });
  for (const size of [{ width: 12001, height: 1000 }, { width: 10000, height: 6001 }]) assert.equal(cutout.inputTransform(size).error, 'photo_too_large');
});

test('crop preserves the specified face expansion before body-guided padding', () => {
  const face = { x: 400, y: 200, width: 100, height: 100 }, size = { width: 1000, height: 1000 };
  const crop = cutout.headShouldersBox(face, { x: 100, y: 200, width: 300, height: 160 }, size);
  assert.equal(crop.ok, true); assert.equal(crop.box.y, 120); assert.equal(crop.box.height, 400);
  assert.ok(crop.box.x <= 320 && crop.box.x + crop.box.width >= 580);
});

test('pure cutout module stays outside the server and Worker import graph', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const root = resolve(import.meta.dirname, '..'), seen = new Set();
  function walk(path) {
    if (seen.has(path) || !existsSync(path) || !/\.(?:js|mjs)$/.test(path)) return;
    seen.add(path);
    for (const forbidden of ['lib/templateSwapCutout.mjs', 'app/veyrnox/_lib/templateSwapClient.mjs', 'app/veyrnox/_lib/templateSwapStore.mjs', 'app/veyrnox/_lib/templateSwapActions.mjs']) assert.notEqual(path, resolve(root, forbidden));
    const source = readFileSync(path, 'utf8');
    const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*|\b(?:import|require)\s*\(\s*)['"]([^'"]+)['"]/g)];
    for (const [, specifier] of imports) if (specifier.startsWith('.')) walk(resolve(dirname(path), specifier));
  }
  for (const entry of ['worker.js', 'app/api/v1/jobs/route.js', 'app/api/v1/generations/route.js', 'app/api/catalog/route.js']) walk(resolve(root, entry));
  assert.ok(seen.size > 20);
  const source = readFileSync(resolve(root, 'lib/templateSwapCutout.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|document|window|Worker|OffscreenCanvas|fetch)\s*[.(]/);
});
test('resizing inclusive aspect boundaries does not round outside server limits', () => {
  for (const kind of ['frontal', 'crop']) for (const size of [{ width: 6000, height: 2400 }, { width: 2400, height: 6000 }]) {
    const output = cutout.outputSize(size, kind);
    assert.equal(output.ok, true);
    assert.equal(cutout.checkOutputSize(output, kind).ok, true);
  }
});
