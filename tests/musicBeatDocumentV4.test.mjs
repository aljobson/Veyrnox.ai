import test from 'node:test';
import assert from 'node:assert/strict';
import { make, legacy, v2, v3, freeze } from './musicBeatFixtures.mjs';
import { midiDoc } from './musicBeatMidiFixtures.mjs';
import { validateBeat, migrateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { eventsAtStep } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
test('v1–v3 migrate purely to v4 with unchanged drums; v4 is idempotent', () => {
  for (const source of [legacy(), v2(), v3()]) {
    const before = structuredClone(source), next = migrateBeat(freeze(source));
    assert.equal(next.version, 4); assert.equal(validateBeat(next).ok, true); assert.deepEqual(source, before);
    const old = source.version === 1 ? { ...v2(), view: 'pattern' } : source;
    for (let step = 0; step < 64; step++) assert.deepEqual(eventsAtStep(next, step), eventsAtStep(old, step));
  }
  const doc = make(); assert.equal(migrateBeat(doc), doc);
});
test('v4 accepts 5,000 project notes across clips and refuses 5,001 with a reason', () => {
  const doc = midiDoc();
  for (let c = 1; c <= 3; c++) doc.clips[`c${c}`] = { name: 'Clip', lengthTicks: 64 * 3840, notes: Array.from({ length: c === 3 ? 1000 : 2000 }, (_, i) => [i * 60, 30, 60, 100]) };
  assert.equal(validateBeat(doc).ok, true);
  doc.clips.c3.notes.push([1000 * 60, 30, 60, 100]);
  assert.match(validateBeat(doc).reason, /5,000/);
});
for (const [name, mutate] of Object.entries({
  duplicate: (d) => d.clips.c1.notes.push([0, 30, 60, 80]),
  unsorted: (d) => d.clips.c1.notes.unshift([240, 30, 61, 80]),
  short: (d) => d.clips.c1.notes[0][1] = 29,
  pitch: (d) => d.clips.c1.notes[0][2] = 109,
  velocity: (d) => d.clips.c1.notes[0][3] = 0,
  fractional: (d) => d.clips.c1.notes[0][0] = 0.1,
  phase: (d) => d.tracks[1].regions[0].phaseTicks = 3840,
  instrument: (d) => d.tracks[1].instrument.preset = 'grand',
  unknown: (d) => d.tracks[1].instrument.extra = true,
  clipLength: (d) => d.clips.c1.lengthTicks = 241,
  clipId: (d) => d.clips.nope = d.clips.c1,
  missing: (d) => delete d.clips,
})) test(`v4 refuses ${name} without repairing`, () => {
  const doc = midiDoc([[0, 30, 60, 100]]); mutate(doc); const before = structuredClone(doc);
  assert.equal(validateBeat(doc).ok, false); assert.throws(() => migrateBeat(doc)); assert.deepEqual(doc, before);
});
