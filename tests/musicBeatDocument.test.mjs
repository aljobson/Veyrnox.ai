import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_LIMITS, createBeat, validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
const make = () => createBeat({ id: 'e40439d1-646a-4c11-9c12-69fa3a851234', now: 10 });

test('new beat round trips and has only the A starter groove', () => {
  const doc = make();
  const result = validateBeat(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(result, { ok: true, doc });
  assert.deepEqual(doc.patterns.A.rows.kick, [[0, 100], [8, 100]]);
  assert.deepEqual(doc.patterns.A.rows.snare, [[4, 100], [12, 100]]);
  assert.deepEqual(doc.patterns.A.rows.hat.map(([s]) => s), [0, 2, 4, 6, 8, 10, 12, 14]);
  for (const slot of ['B', 'C', 'D']) assert.ok(Object.values(doc.patterns[slot].rows).every((row) => row.length === 0));
  assert.equal(doc.currentPattern, 'A');
  assert.equal(BEAT_LIMITS.projects, 50);
});
const malformed = {
  null: () => null,
  kind: (d) => { d.kind = 'other'; }, version: (d) => { d.version = 6; }, id: (d) => { d.id = '../bad'; },
  extra: (d) => { d.extra = true; }, missing: (d) => { delete d.tracks; },
  longTitle: (d) => { d.title = 'x'.repeat(81); }, emptyTitle: (d) => { d.title = ' '; }, titleType: (d) => { d.title = 1; },
  createdAt: (d) => { d.createdAt = -1; }, updatedAt: (d) => { d.updatedAt = 9; }, timestamp: (d) => { d.updatedAt = 1.2; },
  tempo: (d) => { d.tempo = {}; }, lowBpm: (d) => { d.tempo.bpm = 39; }, highBpm: (d) => { d.tempo.bpm = 241; }, nanBpm: (d) => { d.tempo.bpm = NaN; }, stringBpm: (d) => { d.tempo.bpm = '92'; },
  signature: (d) => { d.signature = [3, 4]; }, longSignature: (d) => { d.signature.push(4); },
  negativeSwing: (d) => { d.swing = -0.1; }, highSwing: (d) => { d.swing = 0.61; }, swingType: (d) => { d.swing = '0'; },
  metronome: (d) => { d.metronome = 1; }, kit: (d) => { d.tracks[0].kit = 'unknown'; }, steps: (d) => { d.steps = 24; },
  currentPattern: (d) => { d.currentPattern = 'E'; }, missingPattern: (d) => { delete d.patterns.B; }, extraPattern: (d) => { d.patterns.E = { rows: {} }; },
  rows: (d) => { d.patterns.A.rows = []; }, pad: (d) => { d.patterns.A.rows.other = []; },
  duplicate: (d) => { d.patterns.A.rows.kick = [[0, 100], [0, 100]]; }, unsorted: (d) => { d.patterns.A.rows.kick.reverse(); },
  negativeStep: (d) => { d.patterns.A.rows.kick = [[-1, 100]]; }, highStep: (d) => { d.patterns.A.rows.kick = [[32, 100]]; },
  fractionalStep: (d) => { d.patterns.A.rows.kick = [[1.5, 100]]; }, stringStep: (d) => { d.patterns.A.rows.kick = [['1', 100]]; },
  velocity: (d) => { d.patterns.A.rows.kick = [[0, 99]]; }, hitShape: (d) => { d.patterns.A.rows.kick = [[0, 100, 1]]; },
};
for (const [name, change] of Object.entries(malformed)) test(`rejects ${name} without repairing it`, () => {
  const original = make(); const changed = change(original); const doc = changed === null ? null : original;
  const before = structuredClone(doc);
  assert.equal(validateBeat(doc).ok, false);
  assert.deepEqual(doc, before);
});
test('accepts boundary values and hidden hits below 32', () => {
  const doc = make(); doc.title = 'x'.repeat(80); doc.tempo.bpm = 40; doc.swing = 0.6; doc.patterns.B.rows = { kick: [[31, 60]] };
  assert.equal(validateBeat(doc).ok, true);
  doc.tempo.bpm = 240; doc.steps = 32; assert.equal(validateBeat(doc).ok, true);
});
