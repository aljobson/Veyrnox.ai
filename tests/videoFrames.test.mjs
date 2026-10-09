import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameTimes, isVideoFile, VIDEO_TYPES } from '../app/veyrnox/_lib/videoFrames.js';

test('frames are taken from the middle of equal parts, ascending, inside the clip', () => {
  assert.deepEqual(frameTimes(8, 4), [1, 3, 5, 7]);
  assert.deepEqual(frameTimes(10, 2), [2.5, 7.5]);
  assert.deepEqual(frameTimes(6, 1), [3]);
  for (const [d, n] of [[0.2, 4], [3, 3], [600, 4], [1.234, 4]]) {
    const t = frameTimes(d, n);
    assert.equal(t.length, n);
    assert.ok(t.every((x, i) => x >= 0 && x < d && (i === 0 || x > t[i - 1])), `${d}/${n}: ${t}`);
  }
});

test('a very short clip still gets times inside it, never past the end', () => {
  const t = frameTimes(0.04, 3);
  assert.equal(t.length, 3);
  assert.ok(t.every((x) => x >= 0 && x <= 0.04));
});

test('no length or a bad count gives no frames', () => {
  for (const [d, n] of [[0, 4], [-1, 4], [NaN, 4], [Infinity, 4], [8, 0], [8, -1], [8, 2.5], [8, '4'], [undefined, 4]]) assert.deepEqual(frameTimes(d, n), [], `${d}/${n}`);
});

test('video files are recognised by declared type: MP4, WebM and MOV only', () => {
  assert.deepEqual(VIDEO_TYPES, ['video/mp4', 'video/webm', 'video/quicktime']);
  for (const type of VIDEO_TYPES) assert.equal(isVideoFile({ type }), true, type);
  for (const type of ['video/x-matroska', 'image/png', 'audio/mpeg', 'application/pdf', '']) assert.equal(isVideoFile({ type }), false, type);
  assert.equal(isVideoFile(null), false);
  assert.equal(isVideoFile(undefined), false);
});
