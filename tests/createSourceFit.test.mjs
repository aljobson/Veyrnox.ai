import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MAX_ASPECT_CROP_FRACTION, aspectFitPlan, aspectShapeLabel, fitImageFile, fitSourcesForUpload } from '../app/veyrnox/_lib/sourceAspectFit.js';
import { sourceFitState } from '../app/veyrnox/_lib/useSourceFit.js';
import { mediaGenerationSources } from '../app/veyrnox/_lib/chatMedia.js';
import { checkMediaBounds } from '../lib/modelMediaBounds.js';
import { capabilityFor, publicCapabilities } from '../lib/modelCapabilities.js';

const spec = { minAspect: 0.4, maxAspect: 2.5, minSide: 300, maxBytesExclusive: 30_000_000 };
const jpeg = (name = 'photo.jpg') => new File([new Uint8Array(8)], name, { type: 'image/jpeg', lastModified: 7 });

function deps(width, height, { type, size = 100 } = {}) {
  const calls = { draws: [], encodes: [], options: [], closed: 0, canvas: null };
  return { calls, createBitmap: async (_file, options) => { calls.options.push(options); return { width, height, close: () => { calls.closed += 1; } }; },
    createCanvas: () => (calls.canvas = {
      getContext: () => ({ drawImage: (...args) => calls.draws.push(args.slice(1)) }),
      toBlob: (done, wanted, quality) => { calls.encodes.push([wanted, quality]); done(new Blob([new Uint8Array(size)], { type: type || wanted })); },
    }) };
}

test('the owner\'s 629x1600 picture fits with a small crop and then passes the unchanged server check', async () => {
  const before = { dimensions: { width: 629, height: 1600 }, sizeBytes: 1000 };
  assert.equal(checkMediaBounds(spec, before), 'source_aspect_out_of_range');
  const env = deps(629, 1600);
  const fitted = await fitImageFile(jpeg(), spec, env);
  assert.deepEqual([env.calls.canvas.width, env.calls.canvas.height], [629, 1572]);
  assert.deepEqual(env.calls.draws[0], [0, 0, 629, 1572, 0, 0, 629, 1572], 'keeps the top of a too-tall picture');
  assert.equal(fitted.type, 'image/jpeg');
  assert.equal(checkMediaBounds(spec, { dimensions: { width: 629, height: 1572 }, sizeBytes: fitted.size }), null);
  assert.equal(env.calls.closed, 1);
});

test('a too-wide picture is centred; an in-range one is returned untouched', async () => {
  assert.deepEqual(aspectFitPlan({ width: 2600, height: 1000 }, spec), { action: 'crop', rect: { x: 50, y: 0, width: 2500, height: 1000 } });
  const env = deps(1000, 1000);
  const file = jpeg();
  assert.equal(await fitImageFile(file, spec, env), file);
  assert.equal(env.calls.draws.length, 0);
  const noBounds = deps(100, 1000);
  assert.equal(await fitImageFile(file, { minSide: 1 }, noBounds), file);
  assert.equal(noBounds.calls.options.length, 0);
});

test('the crop limit is exactly 10 percent and never enlarges', () => {
  assert.equal(MAX_ASPECT_CROP_FRACTION, 0.1);
  assert.equal(aspectFitPlan({ width: 360, height: 1000 }, spec).action, 'crop');
  assert.deepEqual(aspectFitPlan({ width: 350, height: 1000 }, spec), { action: 'refuse', code: 'source_aspect_out_of_range' });
  for (const size of [{ width: 629, height: 1600 }, { width: 2600, height: 1000 }]) {
    const { rect } = aspectFitPlan(size, spec);
    assert.ok(rect.width <= size.width && rect.height <= size.height);
    assert.ok(rect.x + rect.width <= size.width && rect.y + rect.height <= size.height);
  }
});

test('a crop cannot pass below the minimum side', () => {
  assert.deepEqual(aspectFitPlan({ width: 290, height: 750 }, spec), { action: 'refuse', code: 'source_resolution_out_of_range' });
});

test('EXIF orientation is honoured: the displayed size decides the crop', async () => {
  const env = deps(629, 1600); // A stored 1600x629 JPEG that displays upright.
  await fitImageFile(jpeg(), spec, env);
  assert.deepEqual(env.calls.options[0], { imageOrientation: 'from-image' });
  assert.deepEqual([env.calls.canvas.width, env.calls.canvas.height], [629, 1572]);
});

test('output keeps an allowed type and the byte limit', async () => {
  const avatar = { ...spec, contentTypes: ['image/jpeg', 'image/png'] };
  const webp = new File([new Uint8Array(8)], 'a.webp', { type: 'image/webp' });
  const env = deps(629, 1600);
  assert.equal((await fitImageFile(webp, avatar, env)).type, 'image/jpeg');
  const png = new File([new Uint8Array(8)], 'a.png', { type: 'image/png' });
  assert.equal((await fitImageFile(png, avatar, deps(629, 1600))).type, 'image/png');
  await assert.rejects(fitImageFile(jpeg(), { ...spec, maxBytesExclusive: 50 }, deps(629, 1600, { size: 60 })), error => error.code === 'source_too_large');
});

test('an extreme picture is refused with no upload and no generation request', async () => {
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 300, height: 1600, close() {} });
  let uploads = 0;
  try {
    const sources = { image: [{ file: jpeg('fine.jpg') }, { file: jpeg('tall.jpg') }] };
    await assert.rejects(mediaGenerationSources({ media: { image: { ...spec, maxFiles: 2 } } }, sources, async () => { uploads += 1; return 'key'; }),
      error => error.name === 'GatewayError' && error.code === 'source_aspect_out_of_range');
    assert.equal(uploads, 0);
  } finally { globalThis.createImageBitmap = original; }
});

test('a Library picture is not re-encoded; only local files are fitted', async () => {
  const seen = [];
  const local = { file: jpeg() };
  const fitted = await fitSourcesForUpload({ image: spec, audio: {} }, { image: [local, { assetId: 'a' }, { sourceKey: 'k', file: jpeg() }], audio: { file: jpeg() } }, async (file) => { seen.push(file); return file; });
  assert.deepEqual(seen, [local.file]);
  assert.equal(fitted.size, 1);
});

test('the form reports the plain allowed shape before Generate', async () => {
  const media = { image: spec };
  assert.deepEqual(await sourceFitState(media, { image: { file: jpeg() } }, async () => ({ width: 300, height: 1600 })), { blocked: true, trimmed: false, min: '2:5', max: '5:2' });
  assert.equal((await sourceFitState(media, { image: { file: jpeg() } }, async () => ({ width: 629, height: 1600 }))).trimmed, true);
  assert.equal((await sourceFitState(media, { image: { file: jpeg() } }, async () => null)).blocked, false);
  assert.equal(aspectShapeLabel(0.4), '2:5');
  assert.equal(aspectShapeLabel(2.5), '5:2');
});

test('the catalog publishes the bound the browser needs, and the server bound is unchanged', () => {
  const record = capabilityFor('market:bytedance/seedance-2');
  const published = publicCapabilities(record).media.image;
  assert.deepEqual([published.minAspect, published.maxAspect], [record.media.image.minAspect, record.media.image.maxAspect]);
  assert.deepEqual([record.media.image.minAspect, record.media.image.maxAspect], [0.4, 2.5]);
  assert.equal(publicCapabilities(record).media.video, undefined);
  const page = readFileSync('app/veyrnox/app/create/page.js', 'utf8');
  assert.match(page, /missingSource \|\| sourceFit\.blocked \|\| missingConsent/);
});

test('swap photo processing does not use the fit path', () => {
  for (const file of ['app/veyrnox/_lib/templateSwapRuntime.js', 'app/veyrnox/_lib/templateSwapPhoto.mjs']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /sourceAspectFit|mediaGenerationSources/, file);
  }
});
