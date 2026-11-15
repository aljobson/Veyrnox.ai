import test from 'node:test';
import assert from 'node:assert/strict';
import { PPQ, stepTicks, stepSeconds, stepTime, loopSeconds, nearestStep } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
test('sixteenths and swung odd steps follow the specified timing', () => {
  assert.equal(PPQ, 960); assert.equal(stepTicks, 240);
  assert.equal(stepSeconds(120), 0.125);
  assert.equal(stepTime(1, 120, 0.5), 0.125 + 0.03125);
  assert.equal(stepTime(2, 120, 0.5), 0.25);
  assert.equal(loopSeconds(120, 16), 2);
});
test('nearest step rounds, respects swing, and wraps in either direction', () => {
  assert.equal(nearestStep(0.07, 120, 0, 16), 1);
  assert.equal(nearestStep(0.07, 120, 0.5, 16), 0);
  assert.equal(nearestStep(0.16, 120, 0.5, 16), 1);
  assert.equal(nearestStep(1.99, 120, 0.5, 16), 0);
  assert.equal(nearestStep(2.16, 120, 0.5, 16), 1);
  assert.equal(nearestStep(-0.01, 120, 0, 16), 0);
});
