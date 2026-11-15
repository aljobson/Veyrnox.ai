import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPosition } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
test('shared positions distinguish bars, beats and steps without decimals', () => {
  assert.equal(formatPosition(4 * 3840), 'bar 5');
  assert.equal(formatPosition(4 * 3840 + 960), 'bar 5, beat 2');
  assert.equal(formatPosition(4 * 3840 + 960 + 480), 'bar 5, beat 2, step 3');
  for (let tick = 0; tick < 512 * 3840; tick += 240) assert.doesNotMatch(formatPosition(tick), /\./);
});
