import test from 'node:test';
import assert from 'node:assert/strict';
import { createBeat, validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { patternEvents } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
const make = () => createBeat({ id: 'e40439d1-646a-4c11-9c12-69fa3a851234', now: 0 });
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
test('all edits are immutable, valid, and stamp injected time', () => {
  const doc = freeze(make());
  const operations = [
    () => ops.toggleStep(doc, 'kick', 1, 20), () => ops.cycleVelocity(doc, 'kick', 0, 1, 20),
    () => ops.addHitAtStep(doc, 'clap', 3, 20), () => ops.setTempo(doc, 120, 20), () => ops.setSwing(doc, 0.5, 20),
    () => ops.setTrackKit(doc, 't1', 'lofi', 20), () => ops.setSteps(doc, 32, 20), () => ops.selectPattern(doc, 'C', 20),
    () => ops.copyPattern(doc, 'A', 'B', 20), () => ops.clearPattern(doc, 20), () => ops.rename(doc, 'Beat', 20),
    () => ops.setMetronome(doc, true, 20), () => ops.restorePattern(doc, 'B', doc.patterns.A, 20),
  ];
  for (const operation of operations) { const next = operation(); assert.notEqual(next, doc); assert.equal(validateBeat(next).ok, true); assert.equal(next.updatedAt, 20); }
  assert.deepEqual(doc, make());
});
test('velocity cycles in either direction; inactive steps stay off', () => {
  let doc = make();
  for (const velocity of [127, 60, 100]) { doc = ops.cycleVelocity(doc, 'kick', 0, 1, 1); assert.equal(doc.patterns.A.rows.kick[0][1], velocity); }
  doc = ops.cycleVelocity(doc, 'kick', 0, -1, 2); assert.equal(doc.patterns.A.rows.kick[0][1], 60);
  assert.deepEqual(ops.cycleVelocity(doc, 'kick', 3, 1, 2).patterns, doc.patterns);
});
test('32 to 16 preserves hidden hits and events respect the active length', () => {
  let doc = ops.addHitAtStep(ops.setSteps(make(), 32), 'crash', 31);
  doc = ops.setSteps(doc, 16);
  assert.deepEqual(doc.patterns.A.rows.crash, [[31, 100]]);
  assert.ok(!patternEvents(doc).some((e) => e.step === 31));
  assert.ok(patternEvents(ops.setSteps(doc, 32)).some((e) => e.step === 31));
});
test('copy, clear, restore, toggling and recording do not alias or duplicate', () => {
  const original = make();
  let doc = ops.copyPattern(original, 'A', 'B');
  doc = ops.clearPattern(doc); assert.deepEqual(doc.patterns.A.rows, {}); assert.deepEqual(doc.patterns.B, original.patterns.A);
  doc = ops.restorePattern(doc, 'A', original.patterns.A);
  doc = ops.addHitAtStep(ops.addHitAtStep(doc, 'kick', 3), 'kick', 3);
  assert.equal(doc.patterns.A.rows.kick.filter(([step]) => step === 3).length, 1);
  doc = ops.toggleStep(doc, 'kick', 3); assert.ok(!doc.patterns.A.rows.kick.some(([step]) => step === 3));
  assert.equal(patternEvents(original).find((e) => e.pad === 'kick').velocity, 100 / 127);
});
test('out-of-range edits reject', () => {
  assert.throws(() => ops.setTempo(make(), 241), /invalid/);
  assert.throws(() => ops.addHitAtStep(make(), 'kick', 32), /invalid/);
});

test('a backwards clock never reduces updatedAt or invalidates a new beat', () => {
  const doc = freeze(createBeat({ id: make().id, now: 100 }));
  const changed = ops.rename(doc, 'After clock rollback', 50);
  const later = ops.setTempo(changed, 120, 150);
  const rolledBack = ops.setSwing(later, 0.5, 75);

  assert.equal(changed.updatedAt, 100);
  assert.equal(later.updatedAt, 150);
  assert.equal(rolledBack.updatedAt, 150);
  assert.equal(validateBeat(changed).ok, true);
  assert.equal(validateBeat(rolledBack).ok, true);
});

test('recording over an existing hit preserves its velocity and document identity', () => {
  for (const direction of [-1, 0, 1]) {
    const doc = freeze(direction ? ops.cycleVelocity(make(), 'kick', 0, direction, 10) : make());
    const recorded = ops.addHitAtStep(doc, 'kick', 0, 20);

    assert.equal(recorded, doc);
    assert.equal(recorded.patterns.A.rows.kick[0][1], direction === -1 ? 60 : direction === 1 ? 127 : 100);
  }
});
