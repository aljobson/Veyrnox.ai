import test from 'node:test';
import assert from 'node:assert/strict';
import { make } from './musicBeatFixtures.mjs';
import { eventsAtStep, recordTarget } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
import { exportRange, exportSize, BeatExportError, playbackStart, sequenceFor } from '../app/veyrnox/_lib/music/beat/beatSequence.mjs';
import { addTrack, addHitToPattern } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { clampLocator, moveLocator } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';

test('song view honors mute and solo; pattern view ignores both and uses the edit track', () => {
  const doc = addTrack(make(), 'lofi');
  doc.tracks[1].regions = [{ ...doc.tracks[0].regions[0], id: 'r2' }];
  assert.equal(eventsAtStep(doc, 0).length, 4);
  doc.tracks[1].solo = true;
  assert.deepEqual([...new Set(eventsAtStep(doc, 0).map((e) => e.trackId))], ['t2']);
  doc.tracks[1].mute = true;
  assert.deepEqual(eventsAtStep(doc, 0), []);
  doc.view = 'pattern';
  assert.deepEqual([...new Set(eventsAtStep(doc, 16, { editTrackId: 't2' }).map((e) => e.trackId))], ['t2']);
  assert.deepEqual([...new Set(eventsAtStep(doc, 0, { editTrackId: 'missing' }).map((e) => e.trackId))], ['t1']);
});
test('offsets wrap; recording targets the region pattern even when muted or not selected', () => {
  const doc = make();
  doc.patterns.B.rows = { kick: [[0, 60], [4, 127]] };
  doc.tracks[0].regions = [{ id: 'r1', start: 3840, length: 7680, offset: 960, pattern: 'B' }];
  assert.equal(recordTarget(doc, 15, 't1'), null);
  assert.deepEqual(recordTarget(doc, 16, 't1'), { pattern: 'B', step: 4 });
  assert.deepEqual(recordTarget(doc, 28, 't1'), { pattern: 'B', step: 0 });
  assert.deepEqual(eventsAtStep(doc, 32), [{ trackId: 't1', pad: 'kick', velocity: 1 }]);
  doc.tracks[0].mute = true;
  const target = recordTarget(doc, 17, 't1');
  const next = addHitToPattern(doc, target.pattern, 'snare', target.step);
  assert.deepEqual(next.patterns.B.rows.snare, [[5, 100]]);
  assert.deepEqual(next.patterns.A, doc.patterns.A);
  doc.view = 'pattern';
  assert.deepEqual(recordTarget(doc, 33, 't1'), { pattern: 'A', step: 1 });
});
test('export range uses whole song or cycle, empty songs retain a loop, oversized allocations reject', () => {
  const doc = make();
  assert.deepEqual(exportRange(doc), { startStep: 0, endStep: 64 });
  doc.tracks[0].regions = [];
  assert.deepEqual(exportRange(doc), { startStep: 0, endStep: 16 });
  doc.cycle = { on: true, start: 240, end: 100 * 3840 };
  const range = exportSize(doc);
  assert.deepEqual(exportRange(doc), { startStep: 1, endStep: 1600 });
  assert.equal(range.frames, Math.ceil((1599 * 15 / doc.tempo.bpm + 1.5) * 44100));
  doc.tempo.bpm = 40; doc.cycle.end = 102 * 3840;
  assert.throws(() => exportRange(doc), BeatExportError);
  assert.throws(() => exportSize(doc), BeatExportError);
});
test('sequence starts from locator inside cycle, cycle start outside it and locator without cycle', () => {
  const doc = make(); doc.cycle = { on: true, start: 3840, end: 7680 };
  assert.equal(sequenceFor(doc, 4800).startStep, 20);
  assert.equal(sequenceFor(doc, 0).startStep, 16);
  assert.equal(sequenceFor(doc, 7680).startStep, 16);
  doc.cycle.on = false;
  assert.equal(sequenceFor(doc, 4800).startStep, 20);
  assert.equal(sequenceFor(doc, 99999).startStep, 0);
  doc.view = 'pattern';
  assert.deepEqual(sequenceFor(doc, 4800).loop, { start: 0, end: 16 });
});
test('Play restarts at song end and declines an empty song unless a cycle or pattern is playing', () => {
  const doc = make();
  for (const locator of [64 * 240, 65 * 240]) {
    assert.equal(playbackStart(doc, locator), 0);
    assert.equal(sequenceFor(doc, locator).startStep, 0);
  }
  assert.equal(playbackStart(doc, 240), 1);
  doc.tracks[0].regions = [];
  assert.equal(playbackStart(doc, 0), null);
  assert.equal(playbackStart(doc, 3840), null);
  doc.cycle = { on: true, start: 3840, end: 7680 };
  assert.equal(playbackStart(doc, 0), 16);
  assert.equal(playbackStart(doc, 4800), 20);
  assert.equal(playbackStart(doc, 7680), 16);
  doc.view = 'pattern';
  doc.cycle.on = false;
  assert.equal(playbackStart(doc, 3840), 0);
});
test('keyboard locator snaps and clamps arrows, pages, Home and End', () => {
  assert.equal(clampLocator(-240, 15360), 0); assert.equal(clampLocator(99999, 15360), 15360);
  assert.equal(moveLocator(3840, 'ArrowRight', 960, 15360), 4800);
  assert.equal(moveLocator(3840, 'ArrowLeft', 480, 15360), 3360);
  assert.equal(moveLocator(3840, 'PageDown', 240, 15360), 7680);
  assert.equal(moveLocator(0, 'PageUp', 240, 15360), 0);
  assert.equal(moveLocator(3840, 'Home', 240, 15360), 0);
  assert.equal(moveLocator(3840, 'End', 240, 15360), 15360);
});
