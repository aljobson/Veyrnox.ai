import test from 'node:test';
import assert from 'node:assert/strict';
import { v2 as make, legacy, freeze } from './musicBeatFixtures.mjs';
import { validateBeat, migrateBeat, songEnd } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { patternEvents, eventsAtStep, effectiveTrackGain } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';

test('v2 starter round trips with four bars, unity gain and song view', () => {
  const doc = make();
  assert.equal(doc.version, 2); assert.equal(doc.view, 'song'); assert.equal(doc.kit, undefined);
  assert.equal(songEnd(doc), 4 * 3840); assert.equal(effectiveTrackGain(doc, 't1'), 1);
  assert.deepEqual(validateBeat(JSON.parse(JSON.stringify(doc))), { ok: true, doc });
  assert.equal(migrateBeat(doc).version, 3);
});
test('valid v1 migrates without changing pattern hits, kit or loudness; original remains untouched', () => {
  const original = legacy(); original.steps = 32; original.currentPattern = 'B'; original.kit = 'lofi';
  original.patterns.B.rows = { kick: [[3, 60], [31, 127]] };
  const before = structuredClone(original); freeze(original);
  const next = migrateBeat(original);
  assert.equal(validateBeat(next).ok, true); assert.equal(next.view, 'pattern');
  assert.equal(next.tracks[0].kit, 'lofi'); assert.equal(effectiveTrackGain(next, 't1'), 1);
  assert.deepEqual(next.cycle, { on: false, start: 0, end: 32 * 240 });
  for (let step = 0; step < 64; step++) {
    assert.deepEqual(eventsAtStep(next, step).map(({ pad, velocity }) => ({ pad, velocity })),
      patternEvents(original).filter((e) => e.step === step % 32).map(({ pad, velocity }) => ({ pad, velocity })));
  }
  assert.deepEqual(original, before);
});
test('migration rejects damaged v1 and unknown versions instead of repairing them', () => {
  const bad = legacy(); bad.patterns.A.rows.kick.push([0, 100]);
  assert.throws(() => migrateBeat(bad), /invalid/);
  assert.throws(() => migrateBeat({ ...legacy(), version: 3 }), /invalid/);
  assert.throws(() => migrateBeat({ ...legacy(), kit: 'missing' }), /invalid/);
});
const cases = {
  'no tracks': (d) => { d.tracks = []; },
  '17 tracks': (d) => { d.tracks = Array.from({ length: 17 }, (_, i) => ({ ...d.tracks[0], id: `t${i}`, regions: [] })); },
  '401 regions': (d) => { d.tracks[0].regions = Array.from({ length: 401 }, (_, i) =>
    ({ id: `r${i}`, start: i * 240, length: 240, offset: 0, pattern: 'A' })); },
  'overlap': (d) => { d.tracks[0].regions.push({ ...d.tracks[0].regions[0], id: 'r2', start: 240 }); },
  'duplicate track id': (d) => { d.tracks.push({ ...d.tracks[0], regions: [] }); },
  'duplicate region id across tracks': (d) => { d.tracks.push({ ...d.tracks[0], id: 't2' }); },
  'bad track id': (d) => { d.tracks[0].id = 'Drums'; },
  'empty region id': (d) => { d.tracks[0].regions[0].id = ''; },
  'fractional start': (d) => { d.tracks[0].regions[0].start = 1; },
  'negative start': (d) => { d.tracks[0].regions[0].start = -240; },
  'zero length': (d) => { d.tracks[0].regions[0].length = 0; },
  'bad offset': (d) => { d.tracks[0].regions[0].offset = 3840; },
  'long name': (d) => { d.tracks[0].name = 'a'.repeat(41); },
  'bad gain': (d) => { d.tracks[0].gain = 1.1; },
  'bad pan': (d) => { d.tracks[0].pan = -1.1; },
  'song beyond 512 bars': (d) => { d.tempo.bpm = 240; d.tracks[0].regions[0].length = 513 * 3840; },
  'song beyond 600s at 40 BPM': (d) => { d.tempo.bpm = 40; d.tracks[0].regions[0].length = 101 * 3840; },
  'cycle beyond 512 bars': (d) => { d.tempo.bpm = 240; d.cycle.end = 513 * 3840; },
  'cycle beyond 600s even when off': (d) => { d.tempo.bpm = 40; d.cycle.end = 101 * 3840; },
  'empty cycle': (d) => { d.cycle.end = 0; },
  'bad cycle tick': (d) => { d.cycle.start = 1; },
};
for (const [name, mutate] of Object.entries(cases)) test(`v2 rejects ${name}`, () => {
  const doc = make(); mutate(doc); const before = structuredClone(doc);
  assert.equal(validateBeat(doc).ok, false); assert.deepEqual(doc, before);
});
test('exact boundaries and a silent cycle beyond the song are valid', () => {
  const doc = make(); doc.tempo.bpm = 40; doc.tracks[0].regions[0].length = 100 * 3840;
  doc.cycle = { on: true, start: 412 * 3840, end: 512 * 3840 };
  assert.equal(validateBeat(doc).ok, true);
});
