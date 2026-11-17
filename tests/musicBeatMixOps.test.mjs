import test from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../app/veyrnox/_lib/music/beat/beatMixOps.mjs';
import { validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { tryOp } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { createHistory, record, undo } from '../app/veyrnox/_lib/music/beat/beatHistory.mjs';
import { convertDrums } from '../app/veyrnox/_lib/music/beat/beatMidiOps.mjs';
import { trackContributes } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
import { make, freeze } from './musicBeatFixtures.mjs';
function base() { return ops.addAutomationPoint(ops.addEffect(ops.addEffect(make(), 't1', 'eq'), 't1', 'delay'), 't1', 'gain', 0, 1); }
const cases = [d => ops.addEffect(d, 't1', 'reverb'), d => ops.removeEffect(d, 't1', 'f1'), d => ops.moveEffect(d, 't1', 'f1', 1),
  d => ops.setEffectBypass(d, 't1', 'f1', true), d => ops.setEffectParam(d, 't1', 'f1', 'low', 6), d => ops.setSend(d, 't1', 'reverb', 0.3),
  d => ops.setMaster(d, { gain: 0.7, delay: { time: 0.2 } }), d => ops.addAutomationPoint(d, 't1', 'gain', 960, 0.5),
  d => ops.moveAutomationPoint(d, 't1', 'gain', 0, 60, 0.9), d => ops.setAutomationCurve(d, 't1', 'gain', 0, -0.6),
  d => ops.removeAutomationPoint(d, 't1', 'gain', 0), d => ops.clearAutomation(d, 't1', 'gain')];
for (const op of cases) test(`valid, pure and undoable: ${op}`, () => {
  const original = base(), before = structuredClone(original), next = op(freeze(original));
  assert.equal(validateBeat(next).ok, true); assert.deepEqual(original, before);
  const restored = undo(record(createHistory(original), next)).present;
  assert.deepEqual({ ...restored, updatedAt: original.updatedAt }, original);
});
test('limits and invalid edits refuse atomically; removing the last point removes its lane', () => {
  let doc = base(); doc = ops.addEffect(ops.addEffect(doc, 't1', 'eq'), 't1', 'eq');
  assert.match(tryOp(doc, d => ops.addEffect(d, 't1', 'eq')).refused, /4 effects/);
  for (let i = 1; i < 64; i++) doc = ops.addAutomationPoint(doc, 't1', 'gain', i * 60, 1);
  assert.match(tryOp(doc, d => ops.addAutomationPoint(d, 't1', 'gain', 3840, 1)).refused, /64 points/);
  for (const op of [d => ops.moveAutomationPoint(d, 't1', 'gain', 0, 60, 1), d => ops.setEffectParam(d, 't1', 'f1', 'low', 13),
    d => ops.setSend(d, 't1', 'unknown', 0.2), d => ops.setMaster(d, { reverb: { size: 1 } })]) {
    const result = tryOp(doc, op); assert.ok(result.refused); assert.equal(result.doc, doc);
  }
  assert.equal(ops.removeAutomationPoint(base(), 't1', 'gain', 0).tracks[0].automation, undefined);
});
test('continuous edits coalesce into one undo entry; conversion deep-copies audible automation, FX and sends', () => {
  let doc = ops.setSend(base(), 't1', 'delay', 0.3); doc.tracks[0].gain = 0;
  let history = createHistory(doc);
  for (let i = 1; i <= 5; i++) history = record(history, ops.setEffectParam(history.present, 't1', 'f1', 'low', i), { key: 't1:fx:f1:low', now: i * 100 });
  assert.equal(history.past.length, 1); assert.equal(undo(history).present.tracks[0].fx[0].params.low, 0);
  const next = convertDrums(doc, 'r1'); assert.equal(validateBeat(next).ok, true); assert.equal(trackContributes(next, 't2', 'song'), true);
  for (const key of ['fx', 'sends', 'automation']) { assert.deepEqual(next.tracks[1][key], doc.tracks[0][key]); assert.notEqual(next.tracks[1][key], next.tracks[0][key]); }
  const restored = undo(record(createHistory(doc), next)).present; assert.deepEqual({ ...restored, updatedAt: doc.updatedAt }, doc);
});

test('removing the last effect and clearing sends restores the original document at the same edit time', t => {
  t.mock.method(Date, 'now', () => 0);
  const doc = make();
  assert.deepEqual(ops.removeEffect(ops.addEffect(doc, 't1', 'eq'), 't1', 'f1'), doc);
  assert.deepEqual(ops.setSend(ops.setSend(doc, 't1', 'reverb', 0.4), 't1', 'reverb', 0), doc);
  assert.deepEqual(ops.setSend(doc, 't1', 'delay', 0), doc);
  let both = ops.setSend(ops.setSend(doc, 't1', 'reverb', 0.4), 't1', 'delay', 0.2);
  both = ops.setSend(both, 't1', 'reverb', 0);
  assert.deepEqual(both.tracks[0].sends, { reverb: 0, delay: 0.2 });
  const lanes = ops.addAutomationPoint(ops.addAutomationPoint(doc, 't1', 'gain', 0, 0.8), 't1', 'pan', 0, 0.2);
  const gainOnly = ops.removeAutomationPoint(lanes, 't1', 'pan', 0);
  assert.deepEqual(gainOnly.tracks[0].automation, { gain: [[0, 0.8, 0]] });
  assert.deepEqual(ops.clearAutomation(gainOnly, 't1', 'gain'), doc);
});
