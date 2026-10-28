import test from 'node:test';
import assert from 'node:assert/strict';
import { fileMediaType, pickerAccept, uploadPlan, convertedName } from '../lib/uploadInputTypes.mjs';
import { ALLOWED_UPLOAD_TYPES } from '../lib/uploadSource.js';
import { attachAccept } from '../lib/createAttach.mjs';

const file = (name, type = '') => ({ name, type });

test('stored types upload as they are', () => {
  assert.deepEqual(uploadPlan(file('a.png', 'image/png')), { kind: 'image', from: 'image/png', to: null });
  assert.deepEqual(uploadPlan(file('a.mp4', 'video/mp4')), { kind: 'video', from: 'video/mp4', to: null });
  assert.deepEqual(uploadPlan(file('a.wav', 'audio/x-wav')), { kind: 'audio', from: 'audio/wav', to: null });
});

test('iPhone and web formats are converted to a type the gateway stores', () => {
  assert.equal(uploadPlan(file('IMG_1.HEIC', '')).to, 'image/jpeg');
  assert.equal(uploadPlan(file('a.heif', 'image/heif')).to, 'image/jpeg');
  assert.equal(uploadPlan(file('a.avif', 'image/avif')).to, 'image/png');
  assert.equal(uploadPlan(file('a.gif', 'image/gif')).to, 'image/png');
  assert.equal(uploadPlan(file('IMG_2.MOV', 'video/quicktime')).to, 'video/mp4');
  assert.equal(uploadPlan(file('a.webm', 'video/webm')).to, 'video/mp4');
  for (const name of ['a.heic', 'a.avif', 'a.gif', 'a.mov', 'a.webm']) {
    assert.ok(Object.hasOwn(ALLOWED_UPLOAD_TYPES, uploadPlan(file(name)).to), name);
  }
});

test('anything else is refused, never guessed', () => {
  assert.equal(uploadPlan(file('a.html', 'text/html')), null);
  assert.equal(uploadPlan(file('a.svg', 'image/svg+xml')), null);
  assert.equal(uploadPlan(file('noext', '')), null);
  assert.equal(uploadPlan(file('a.exe', 'application/octet-stream')), null);
});

test('the declared type wins over the extension unless it is empty or generic', () => {
  assert.equal(fileMediaType(file('a.png', 'image/jpeg')), 'image/jpeg');
  assert.equal(fileMediaType(file('a.mov', 'application/octet-stream')), 'video/quicktime');
  assert.equal(fileMediaType(file('a.jpg', 'image/jpg')), 'image/jpeg');
});

test('pickers offer the new types and their extensions', () => {
  assert.match(pickerAccept('image'), /image\/heic/);
  assert.match(pickerAccept('image'), /\.heic/);
  assert.match(pickerAccept('video'), /video\/quicktime/);
  assert.match(pickerAccept('video'), /\.webm/);
  assert.doesNotMatch(pickerAccept('audio'), /video|image/);
  assert.match(attachAccept(), /\.mov/);
});

test('converted files keep their name stem', () => {
  assert.equal(convertedName('IMG_0001.HEIC', 'image/jpeg'), 'IMG_0001.jpg');
  assert.equal(convertedName('clip.final.mov', 'video/mp4'), 'clip.final.mp4');
  assert.equal(convertedName('', 'image/png'), 'upload.png');
});
