import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPosition, formatNoteLength } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
test('shared positions distinguish bars, beats and steps without decimals', () => {
  assert.equal(formatPosition(4 * 3840), 'bar 5');
  assert.equal(formatPosition(4 * 3840 + 960), 'bar 5, beat 2');
  assert.equal(formatPosition(4 * 3840 + 960 + 480), 'bar 5, beat 2, step 3');
  for (let tick = 0; tick < 512 * 3840; tick += 240) assert.doesNotMatch(formatPosition(tick), /\./);
});

test('note lengths use musical fractions and plural bars/beats, rounded to 1/64', () => {
  for (const [ticks, label] of [[30, '1/64'], [51, '1/64'], [240, '1/16'], [480, '1/8'], [960, '1 beat'], [1920, '2 beats'], [3840, '1 bar'], [5760, '1 bar 2 beats'], [7680, '2 bars'], [1020, '1 beat 1/64']]) {
    assert.equal(formatNoteLength(ticks), label);
  }
  for (let ticks = 30; ticks <= 64 * 3840; ticks += 31) assert.doesNotMatch(formatNoteLength(ticks), /\./);
});
