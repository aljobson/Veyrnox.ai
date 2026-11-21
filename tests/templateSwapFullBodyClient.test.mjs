import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwapStore } from '../app/veyrnox/_lib/templateSwapStore.mjs';
import { createSwapActions } from '../app/veyrnox/_lib/templateSwapActions.mjs';
import { fetchSwapAvailability, swapRequest, swapErrorKey, swapImageCounts } from '../app/veyrnox/_lib/templateSwapClient.mjs';
import { processSwapPhoto } from '../app/veyrnox/_lib/templateSwapPhoto.mjs';
import { headShouldersBox, checkFaces } from '../lib/templateSwapCutout.mjs';
import { fullBodyDecodeSize, faceSearchBox, checkFullBodyFace, faceCropBox, landmarkBox, FULL_BODY_MIN_FACE_PX } from '../lib/templateSwapFullBodyGeometry.mjs';
import { templateSwapImageCounts, templateSwapImageCaps } from '../lib/templateSwapFullBody.mjs';

const one = { id: 'community-kitchen-dance-swap', model: 'kling-o1-reference', credits: 47, durationSeconds: 5, role: 'the main character', images: 2 };
const full = { ...one, fullBody: true };
const png = name => Object.assign(new Blob([name], { type: 'image/png' }), { tag: name });
// 478 landmarks: even points on the top-left corner, odd points on the bottom-right corner of the box.
const marks = (x0, x1, y0, y1) => Float32Array.from({ length: 478 * 3 }, (_, i) => { const p = Math.floor(i / 3), c = i % 3; return c === 2 ? 0 : c === 0 ? (p % 2 ? x1 : x0) : (p % 2 ? y1 : y0); });

test('geometry: decode size, search region, 96 px face rule, face crop', () => {
  assert.deepEqual(fullBodyDecodeSize({ width: 3000, height: 6000 }).width, 2048);
  assert.equal(fullBodyDecodeSize({ width: 800, height: 1200 }).scale, 1, 'never upscales the decode');
  const region = faceSearchBox(null, { x: 768, y: 512, width: 576, height: 3456 }, { width: 2048, height: 4096 });
  assert.deepEqual(region, { x: 768, y: 454, width: 576, height: 576 });
  assert.equal(faceSearchBox(null, null, { width: 10, height: 10 }), null);
  const size = { width: 2000, height: 3000 };
  assert.equal(checkFullBodyFace({ x: 10, y: 10, width: 95, height: 120 }, size).error, 'face_too_small_full');
  assert.ok(checkFullBodyFace({ x: 10, y: 10, width: 96, height: 120 }, size).ok);
  assert.equal(checkFullBodyFace({ x: 10, y: 10, width: 70, height: 90 }, size, 0.7).ok, true, 'scale maps decode pixels back to the original');
  const crop = faceCropBox({ x: 900, y: 400, width: 100, height: 130 }, size);
  assert.ok(crop.ok); assert.deepEqual(crop.output, { width: 512, height: 512 }, 'a small face is upscaled to 512');
  assert.ok(crop.box.x <= 900 && crop.box.y <= 400 && crop.box.x + crop.box.width >= 1000 && crop.box.y + crop.box.height >= 530);
  assert.deepEqual(faceCropBox({ x: 0, y: 0, width: 800, height: 900 }, { width: 1200, height: 1200 }).output, { width: 1024, height: 1024 });
  assert.deepEqual(landmarkBox({ count: 1, landmarks: marks(.25, .75, .5, 1) }, { x: 100, y: 200, width: 400, height: 400 }), { x: 200, y: 400, width: 200, height: 200 });
});

test('the relative 5% face rule is unchanged unless the full-body floor is passed', () => {
  const image = { width: 2048, height: 4096 }, face = { x: 1000, y: 600, width: 100, height: 120 };
  assert.equal(checkFaces([face], image).error, 'face_too_small');
  assert.equal(headShouldersBox(face, null, image).error, 'face_too_small');
  const box = headShouldersBox(face, null, image, FULL_BODY_MIN_FACE_PX);
  assert.ok(box.ok); assert.ok(Math.min(box.output.width, box.output.height) >= 512);
});

function fullBodyDeps(second, over = {}) {
  const regions = [], detects = [];
  const background = Float32Array.from({ length: 1024 }, (_, i) => (i % 32 >= 12 && i % 32 <= 20 && i >= 128 && i < 992 ? 0 : 1));
  const body = Float32Array.from(background, v => 1 - v);
  return { regions, detects,
    header: async () => ({ width: 3000, height: 6000, rotation: 0 }),
    bitmap: async (_file, o) => ({ width: o.resizeWidth, height: o.resizeHeight, close() {} }),
    crop: async (_hi, x, y, width, height, o) => ({ width: o.resizeWidth, height: o.resizeHeight, region: { x, y, width, height }, close() {} }),
    vision: async () => ({ segment: async () => ({ width: 32, height: 32, background, body }), close() {} }),
    face: async () => ({ detect: async picture => { detects.push(picture); return detects.length === 1 ? { count: 0, landmarks: new Float32Array() } : second; }, close() {} }),
    encodeRegion: async (_hi, box, output) => { regions.push({ box, output }); return png(`region-${regions.length}`); },
    encodeWhole: async () => png('whole'), ...over };
}

test('a full-length photo whose face the working copy misses: found again at high resolution, three PNGs in request order', async () => {
  const d = fullBodyDeps({ count: 1, landmarks: marks(.35, .65, .2, .6) });
  const result = await processSwapPhoto(new Blob(['x'], { type: 'image/jpeg' }), { deps: d, fullBody: true });
  assert.deepEqual(result.files.map(f => f.tag), ['region-1', 'region-2', 'whole']);
  assert.deepEqual(d.detects[1].region, { x: 768, y: 454, width: 576, height: 576 }, 'second look is on the head region');
  const [face, shoulders] = d.regions;
  assert.deepEqual(face.output, { width: 512, height: 512 });
  assert.ok(shoulders.box.height > face.box.height, 'head-and-shoulders is wider than the face crop');
  assert.ok(result.faceBox.width >= FULL_BODY_MIN_FACE_PX, 'face measured in original pixels');
});

test('full body: face under 96 px gives one clear message; two faces or none are refused before any encode', async () => {
  for (const [second, error] of [[{ count: 1, landmarks: marks(.45, .55, .3, .45) }, /face_too_small_full/],
    [{ count: 2, landmarks: new Float32Array() }, /several_people/], [{ count: 0, landmarks: new Float32Array() }, /no_face/]]) {
    const d = fullBodyDeps(second);
    await assert.rejects(processSwapPhoto(new Blob(['x']), { deps: d, fullBody: true }), error);
    assert.equal(d.regions.length, 0);
  }
  assert.equal(swapErrorKey('face_too_small_full'), 'presets.swap.face_too_small_full');
});

test('client contract: counts, availability and the request carry three images only for a full-body offer', async () => {
  assert.deepEqual(swapImageCounts(one), [2]); assert.deepEqual(swapImageCounts(full), [2, 3]);
  assert.deepEqual(swapImageCounts({ ...full, people: 2, images: 4 }), [4]);
  assert.deepEqual(templateSwapImageCounts(2, true), [4]);
  assert.deepEqual(templateSwapImageCaps(2), [1536, 1024]); assert.deepEqual(templateSwapImageCaps(3), [1024, 1024, 1536]);
  const ask = body => fetchSwapAvailability(body.id, async () => ({ status: 200, json: async () => body }));
  assert.deepEqual(await ask(full), full); assert.deepEqual(await ask(one), one);
  for (const bad of [{ ...one, fullBody: false }, { ...one, fullBody: 'yes' }, { ...full, people: 2, images: 4, roles: ['a', 'b'] }]) assert.equal(await ask(bad), null);
  const refs = n => Array.from({ length: n }, (_, i) => ({ slot: 'image', origin: 'upload', key: `uploads/${i}` }));
  assert.equal(swapRequest(full, 'k', refs(3)).references.length, 3);
  assert.equal(swapRequest(full, 'k', refs(2)).references.length, 2);
  assert.throws(() => swapRequest(one, 'k', refs(3)), /invalid_swap_request/);
});

test('actions: key-off offer calls the photo step exactly as before; full body sends three uploads in order', async () => {
  const store = createSwapStore({ revoke() {} }); store.session('A');
  const seen = [], posted = [], uploaded = [];
  const actions = createSwapActions(store, { makeKey: () => 'key-1',
    processPhoto: async (file, options) => { seen.push(Object.keys(options).sort().join(',')); return { files: options.fullBody ? [png('face'), png('crop'), png('whole')] : [png('front'), png('crop')] }; },
    upload: async file => { uploaded.push(file.tag); return `uploads/${file.tag}`; }, objectURL: file => `blob:${file.tag}`, revokeURL() {},
    gateway: async (_path, init) => { posted.push(JSON.parse(init.body)); return { job_id: 'job', balance_after: 1 }; } });
  await actions.choose(one.id, 'a');
  assert.deepEqual(seen, ['signal']);
  await actions.choose(full.id, 'b', 0, { fullBody: true });
  assert.deepEqual(seen, ['signal', 'fullBody,signal']);
  assert.deepEqual(store.get(full.id).at(-1).urls, ['blob:face', 'blob:crop', 'blob:whole'], 'a new photo replaces the whole set');
  await actions.submit(full.id, full);
  assert.deepEqual(uploaded, ['face', 'crop', 'whole']);
  assert.deepEqual(posted[0].references.map(r => r.key), ['uploads/face', 'uploads/crop', 'uploads/whole']);
});
