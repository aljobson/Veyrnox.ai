import test from 'node:test';
import assert from 'node:assert/strict';
import { make, freeze } from './musicBeatFixtures.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { eventsAtStep } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
import * as history from '../app/veyrnox/_lib/music/beat/beatHistory.mjs';

const operations = {
  addTrack: (d) => ops.addTrack(d, 'lofi', 10), removeTrack: (d) => ops.removeTrack(d, 't2', 10),
  renameTrack: (d) => ops.renameTrack(d, 't1', 'New name', 10),
  setTrackKit: (d) => ops.setTrackKit(d, 't1', 'acoustic', 10),
  setTrackMute: (d) => ops.setTrackMute(d, 't1', true, 10),
  setTrackSolo: (d) => ops.setTrackSolo(d, 't1', true, 10),
  setTrackGain: (d) => ops.setTrackGain(d, 't1', 0.3, 10),
  setTrackPan: (d) => ops.setTrackPan(d, 't1', -0.7, 10),
  addRegion: (d) => ops.addRegion(d, 't1', 3840, 'B', 10),
  moveRegion: (d) => ops.moveRegion(d, 'r1', 3840, 't2', 10),
  copyRegion: (d) => ops.copyRegion(d, 'r1', 3840, 't2', 10),
  resizeRegion: (d) => ops.resizeRegion(d, 'r1', 5 * 3840, 10),
  trimRegionStart: (d) => ops.trimRegionStart(d, 'r1', 240, 10),
  splitRegion: (d) => ops.splitRegion(d, 'r1', 720, 10),
  duplicateRegion: (d) => ops.duplicateRegion(d, 'r1', 10),
  deleteRegion: (d) => ops.deleteRegion(d, 'r1', 10),
  setRegionPattern: (d) => ops.setRegionPattern(d, 'r1', 'C', 10),
  setCycle: (d) => ops.setCycle(d, { on: true, start: 240, end: 3840 }, 10),
  setView: (d) => ops.setView(d, 'pattern', 10),
  addHitToPattern: (d) => ops.addHitToPattern(d, 'D', 'kick', 5, 10),
};
test('track rename trims the name and refuses an empty draft without changing the doc', () => {
  const doc = freeze(make());
  for (const name of ['', '   ', '\t\n']) {
    const result = ops.tryOp(doc, (d) => ops.renameTrack(d, 't1', name, 20));
    assert.equal(result.doc, doc);
    assert.equal(result.refused, 'Give the track a name.');
  }
  const renamed = ops.renameTrack(doc, 't1', '  Drum kit  ', 20);
  assert.equal(renamed.tracks[0].name, 'Drum kit');
  assert.equal(renamed.updatedAt, 20);
  assert.equal(doc.tracks[0].name, 'Drums');
});
for (const [name, operation] of Object.entries(operations)) test(`${name} is immutable, validated, stamped and undoable`, () => {
  const doc = freeze(ops.addTrack(make(), '808', 10)); const before = structuredClone(doc);
  const next = operation(doc);
  assert.equal(validateBeat(next).ok, true); assert.notEqual(next, doc);
  assert.equal(next.updatedAt, 10); assert.deepEqual(doc, before);
  const recorded = history.record(history.createHistory(doc), next, { label: name, now: 10 });
  assert.deepEqual(history.undo(recorded).present, doc);
  assert.deepEqual(history.redo(history.undo(recorded)).present, next);
});
test('edited region wins: trim left, trim right, split containing and remove covered', () => {
  const cases = [
    { start: 0, length: 1920, expected: [[0, 960, 0]] },
    { start: 1920, length: 1920, expected: [[2880, 960, 960]] },
    { start: 0, length: 3840, expected: [[0, 960, 0], [2880, 960, 2880]] },
    { start: 1200, length: 480, expected: [] },
  ];
  for (const { start, length, expected } of cases) {
    const doc = make(); doc.steps = 16;
    doc.tracks[0].regions = [{ id: 'old', start, length, offset: 0, pattern: 'A' }];
    doc.tracks.push({ ...doc.tracks[0], id: 't2', regions: [
      { id: 'edited', start: 0, length: 1920, offset: 0, pattern: 'B' },
    ] });
    const next = ops.moveRegion(freeze(doc), 'edited', 960, 't1', 1);
    assert.deepEqual(next.tracks[0].regions.filter((r) => r.id !== 'edited')
      .map((r) => [r.start, r.length, r.offset]), expected);
    assert.equal(validateBeat(next).ok, true);
    for (let step = 0; step < 16; step++) {
      if (step * 240 >= 960 && step * 240 < 2880) continue;
      assert.deepEqual(eventsAtStep(next, step), eventsAtStep(doc, step));
    }
  }
});

test('split and trim preserve every retained hit including wrapped non-zero offsets', () => {
  for (const steps of [16, 32]) for (const offset of [0, 240, (steps - 1) * 240]) {
    const doc = make(); doc.steps = steps; doc.tracks[0].regions[0].offset = offset;
    const split = ops.splitRegion(freeze(doc), 'r1', 5 * 240);
    const trimmed = ops.trimRegionStart(doc, 'r1', 5 * 240);
    for (let step = 0; step < 64; step++) {
      assert.deepEqual(eventsAtStep(split, step), eventsAtStep(doc, step));
      if (step >= 5) assert.deepEqual(eventsAtStep(trimmed, step), eventsAtStep(doc, step));
    }
  }
});
test('copy inside a containing region reserves distinct fragment ids and preserves phases', () => {
  const doc = make(); doc.tracks[0].regions[0].offset = 240;
  const next = ops.addRegion(freeze(doc), 't1', 480, 'B');
  assert.equal(next.tracks[0].regions.length, 3);
  assert.equal(new Set(next.tracks[0].regions.map((r) => r.id)).size, 3);
  for (let step = 18; step < 64; step++) assert.deepEqual(eventsAtStep(next, step), eventsAtStep(doc, step));
});
test('cross-track move keeps content and offset; changing steps preserves tick geometry', () => {
  const doc = ops.addTrack(ops.setSteps(make(), 32), 'lofi');
  doc.tracks[0].regions[0].offset = 6000;
  const next = ops.moveRegion(freeze(doc), 'r1', 3840, 't2');
  assert.equal(next.tracks[0].regions.length, 0);
  assert.deepEqual(next.tracks[1].regions[0], { ...doc.tracks[0].regions[0], start: 3840 });
  const shorter = ops.setSteps(next, 16);
  assert.deepEqual(shorter.tracks[1].regions[0], { ...next.tracks[1].regions[0], offset: 2160 });
});
test('limits refuse atomically with English reasons, including fragmentation over 400', () => {
  let doc = make();
  for (let i = 1; i < 16; i++) doc = ops.addTrack(doc, '808');
  let result = ops.tryOp(doc, (d) => ops.addTrack(d, '808'));
  assert.equal(result.doc, doc); assert.match(result.refused, /16 tracks/);
  result = ops.tryOp(make(), (d) => ops.removeTrack(d, 't1'));
  assert.match(result.refused, /at least one/);
  doc = make(); doc.tracks[0].regions = Array.from({ length: 400 }, (_, i) =>
    ({ id: `r${i + 1}`, start: i * 3840, length: 3840, offset: 0, pattern: 'A' }));
  doc.tempo.bpm = 240; // 400s; a one-loop insertion replaces a region without growing the count.
  const two = ops.addTrack(doc, '808');
  result = ops.tryOp(two, (d) => ops.copyRegion(d, 'r1', 240, 't2'));
  assert.equal(result.doc, two); assert.match(result.refused, /400 regions/);
  result = ops.tryOp(doc, (d) => ops.addRegion(d, 't1', 240, 'B'));
  assert.equal(result.doc, doc); assert.match(result.refused, /400 regions/);
  result = ops.tryOp(make(), (d) => ops.resizeRegion(d, 'r1', 513 * 3840));
  assert.match(result.refused, /512 bars/);
});
test('tempo and cycle refuse either 600s bound, including a cycle beyond the final region', () => {
  const doc = make(); doc.tempo.bpm = 120;
  doc.cycle = { on: false, start: 0, end: 101 * 3840 };
  assert.match(ops.tryOp(doc, (d) => ops.setTempo(d, 40)).refused, /cycle.*600 seconds/);
  const long = make(); long.tracks[0].regions[0].length = 101 * 3840;
  assert.match(ops.tryOp(long, (d) => ops.setTempo(d, 40)).refused, /song.*600 seconds/);
  const slow = ops.setTempo(make(), 40);
  assert.match(ops.tryOp(slow, (d) => ops.setCycle(d, { on: true, start: 0, end: 101 * 3840 })).refused, /600 seconds/);
  assert.match(ops.tryOp(slow, (d) => ops.setCycle(d, { on: true, start: 0, end: 513 * 3840 })).refused, /512 bars/);
});

test('backwards trim and every placement path preserve the phase of surviving neighbours', () => {
  const doc = make();
  doc.tracks[0].regions = [
    { id: 'left', start: 0, length: 3840, offset: 240, pattern: 'A' },
    { id: 'edit', start: 3840, length: 3840, offset: 240, pattern: 'B' },
    { id: 'right', start: 7680, length: 7680, offset: 480, pattern: 'A' },
  ];
  const trim = ops.trimRegionStart(doc, 'edit', 2880);
  assert.equal(trim.tracks[0].regions.find((r) => r.id === 'edit').offset, 3120);
  const grow = ops.resizeRegion(doc, 'edit', 6000);
  const duplicate = ops.duplicateRegion(doc, 'edit');
  const copy = ops.copyRegion(doc, 'edit', 9600, 't1');
  for (const next of [trim, grow, duplicate, copy]) {
    assert.equal(validateBeat(next).ok, true);
    for (const region of next.tracks[0].regions.filter((r) => r.pattern === 'A')) {
      for (let tick = region.start; tick < region.start + region.length; tick += 240) {
        assert.deepEqual(eventsAtStep(next, tick / 240), eventsAtStep(doc, tick / 240));
      }
    }
  }
});
