import test from 'node:test';
import assert from 'node:assert/strict';
import { midiDoc } from './musicBeatMidiFixtures.mjs';
import * as midi from '../app/veyrnox/_lib/music/beat/beatMidiOps.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import * as history from '../app/veyrnox/_lib/music/beat/beatHistory.mjs';
import { midiNoteOnsInWindow } from '../app/veyrnox/_lib/music/beat/beatMidiWindow.mjs';
test('add, move, resize, velocity and delete are immutable validated edits', () => {
  const base = midiDoc(), added = midi.addNote(base, 'c1', [0, 240, 60, 100]);
  assert.deepEqual(base.clips.c1.notes, []);
  const moved = midi.moveNotes(added, 'c1', ['0:60'], 240, 12);
  const resized = midi.resizeNotes(moved, 'c1', ['240:72'], -230);
  const velocity = midi.velocityNotes(resized, 'c1', ['240:72'], 16);
  assert.deepEqual(velocity.clips.c1.notes, [[240, 30, 72, 116]]);
  assert.deepEqual(midi.deleteNotes(velocity, 'c1', ['240:72']).clips.c1.notes, []);
});
test('quantise resolves 0/60 collision, keeps 30-tick lengths, clamps ends and rounds half strength to integers', () => {
  const doc = midiDoc([[0, 30, 60, 127], [60, 30, 60, 60], [121, 30, 61, 100], [3800, 40, 62, 100]]);
  const next = midi.quantiseNotes(doc, 'c1', ['60:60', '121:61', '3800:62'], 240, 1);
  assert.deepEqual(next.clips.c1.notes, [[0, 30, 60, 60], [240, 30, 61, 100], [3810, 30, 62, 100]]);
  assert.equal(midi.quantiseNotes(doc, 'c1', ['121:61'], 240, 0.5).clips.c1.notes[2][0], 181);
});
test('atomic shortening updates shared/split phases, removes short remnants and undo restores all', () => {
  let doc = midiDoc([[0, 960, 60, 100], [460, 30, 61, 100], [600, 60, 62, 100]]);
  doc = ops.splitRegion(doc, 'r2', 720, 1000);
  const next = midi.setClipLength(doc, 'c1', 480, 2000);
  assert.deepEqual(next.clips.c1.notes, [[0, 480, 60, 100]]);
  assert.equal(next.tracks[1].regions[1].phaseTicks, 240);
  const recorded = history.record(history.createHistory(doc), next, { label: 'shorten', now: 2000 });
  // Undo restores musical content while keeping the latest save timestamp.
  assert.deepEqual(history.undo(recorded).present, { ...doc, updatedAt: 2000 });
});
test('duplicates share; make unique copies; last region removal prunes and undo restores', () => {
  const doc = midiDoc([[0, 240, 60, 100]]), copy = ops.duplicateRegion(doc, 'r2');
  assert.equal(copy.tracks[1].regions[1].clipId, 'c1');
  const unique = midi.makeUnique(copy, copy.tracks[1].regions[1].id);
  assert.equal(Object.keys(unique.clips).length, 2);
  const deleted = ops.deleteRegion(doc, 'r2', 0); assert.deepEqual(deleted.clips, {});
  assert.deepEqual(history.undo(history.record(history.createHistory(doc), deleted, { label: 'delete' })).present, doc);
});
test('MIDI placement refuses drum/audio tracks with a reason', () => {
  const doc = midiDoc();
  assert.match(ops.tryOp(doc, (d) => ops.moveRegion(d, 'r2', 0, 't1')).refused, /same kind/);
  assert.match(ops.tryOp(doc, (d) => midi.addMidiRegion(d, 't1', 0)).refused, /MIDI/);
});
test('split and trim keep all retained onsets and durations except crossing cuts', () => {
  const doc = midiDoc([[0, 960, 60, 100], [480, 240, 62, 100], [960, 240, 64, 100]]);
  const before = midiNoteOnsInWindow(doc, 0, 4);
  const after = midiNoteOnsInWindow(ops.splitRegion(doc, 'r2', 480), 0, 4);
  assert.deepEqual(after.map((n) => n.songTimeSec), before.map((n) => n.songTimeSec));
  assert.equal(after[0].durationSec, 0.25); assert.deepEqual(after.slice(1), before.slice(1));
  assert.deepEqual(midiNoteOnsInWindow(ops.trimRegionStart(doc, 'r2', 480), 0, 4), before.slice(1));
});
