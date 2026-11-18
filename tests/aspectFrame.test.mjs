import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cropRect, takesFrame, FRAME_RATIOS, FRAME_MODELS } from '../lib/aspectFrame.mjs';
import { reframeImage, frameUploader } from '../app/veyrnox/_lib/reframeImage.js';

test('a wide photo cropped to 9:16 keeps its height and loses width from both sides', () => {
  assert.deepEqual(cropRect(1600, 900, '9:16'), { x: 547, y: 0, width: 506, height: 900 });
});

test('a tall photo cropped to 16:9 keeps its width and is centred vertically', () => {
  assert.deepEqual(cropRect(900, 1600, '16:9'), { x: 0, y: 547, width: 900, height: 506 });
});

test('every offered ratio gives a crop of that shape inside the photo', () => {
  for (const ratio of FRAME_RATIOS) {
    const [w, h] = ratio.split(':').map(Number);
    const crop = cropRect(3000, 2000, ratio) ?? cropRect(2000, 3000, ratio);
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 3000 && crop.y + crop.height <= 3000);
    assert.ok(Math.abs(crop.width / crop.height - w / h) < 0.01, ratio);
  }
});

test('no crop when the photo already has the shape, or the ratio is empty, unknown or the size unreadable', () => {
  assert.equal(cropRect(1920, 1080, '16:9'), null);
  assert.equal(cropRect(1000, 1000, ''), null);
  assert.equal(cropRect(1000, 1000, '21:9'), null);
  assert.equal(cropRect(0, 1000, '1:1'), null);
});

test('only the two Kling 3.0 image-to-video models take the frame choice', () => {
  assert.deepEqual([...FRAME_MODELS], ['kling-3.0-i2v', 'kling-3.0-standard-i2v']);
  assert.equal(takesFrame('kling-3.0-standard-i2v'), true);
  assert.equal(takesFrame('seedance-2.0-reference'), false);
});

test('the uploader is untouched without a frame or for another model, and non-images pass through', async () => {
  const upload = async (file) => file;
  assert.equal(frameUploader('kling-3.0-i2v', '', upload), upload);
  assert.equal(frameUploader('veo-3.1', '16:9', upload), upload);
  const audio = { type: 'audio/mpeg' };
  assert.equal(await frameUploader('kling-3.0-i2v', '16:9', upload)(audio), audio);
  assert.equal(await reframeImage(audio, '16:9'), audio);
});

test('an image the browser cannot decode is sent as it is', async () => {
  const file = { type: 'image/png', name: 'a.png' };
  assert.equal(await reframeImage(file, '1:1'), file);
});

test('the frame never becomes a job input or a price: Create reads it only for the upload and the thumbnail', () => {
  const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  const uses = page.split('\n').filter((line) => /\bframe\b/.test(line) && !/^import/.test(line));
  for (const line of uses) assert.doesNotMatch(line, /aspect_ratio|credits|quote|cost/i, line);
  assert.match(page, /frameUploader\(modelId, frame, uploadSourceFile\)/);
});

test('the phone keeps the same models and ratios as the web', () => {
  const phone = readFileSync(new URL('../apps/mobile/src/lib/aspectFrame.ts', import.meta.url), 'utf8');
  for (const ratio of FRAME_RATIOS) assert.ok(phone.includes(`'${ratio}'`), ratio);
  for (const id of FRAME_MODELS) assert.ok(phone.includes(`'${id}'`), id);
});
