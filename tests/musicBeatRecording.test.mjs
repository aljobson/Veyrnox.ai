import test from 'node:test';
import assert from 'node:assert/strict';
import { midiDoc, bass } from './musicBeatMidiFixtures.mjs';
import { createRecording, commitTake, partitionTake, recordingSequence, recordingEndTick, contextTimeToSongTick, takeAsNewBeat } from '../app/veyrnox/_lib/music/beat/beatRecording.mjs';
import { createScheduler } from '../app/veyrnox/_lib/music/beat/beatScheduler.mjs';
import { validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { setTrackMute } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
const BAR = 3840;
function empty() { const doc = midiDoc(); doc.clips = {}; doc.tracks.forEach((t) => t.regions = []); return doc; }
const note = (start, pitch = 60, length = 240) => ({ start, end: start + length, pitch, velocity: 100 });
const take = (notes, extra = {}) => ({ trackId: 't2', startTick: 0, endLimit: 512 * BAR, notes, snap: 0, ...extra });
test('empty-song recording runs past old song end, ignores cycle and count-in captures nothing early', () => {
  const doc = empty(); doc.cycle.on = true;
  const seq = recordingSequence(doc, BAR, true);
  assert.equal(seq.startStep, 0); assert.equal(seq.recordStart, BAR); assert.equal(seq.loop, null); assert.ok(seq.endStep > 16);
  const capture = createRecording(doc, 't2', BAR);
  assert.equal(capture.on('early', 60, 100, BAR - 1), false);
  assert.equal(capture.on('a', 48, 100, BAR + 60), true); capture.off('a', BAR + 600);
  let result;
  capture.finalize(doc, BAR * 2, (d) => { result = d; return true; });
  assert.equal(result.tracks[1].regions[0].start, BAR); assert.deepEqual(result.clips.c1.notes, [[60, 540, 48, 100]]);
  assert.deepEqual(doc.clips, {}); assert.equal(validateBeat(result).ok, true);
});
test('inverse context mapping handles count-in and cycle wraps', () => {
  const map = { contextStart: 10, startTick: -BAR, tempo: 120 };
  assert.equal(contextTimeToSongTick(map, 10), -BAR); assert.equal(contextTimeToSongTick(map, 12), 0);
  const cycle = { ...map, startTick: 240, cycle: { start: 240, end: 720 } };
  assert.equal(contextTimeToSongTick(cycle, 10.25), 240); assert.equal(contextTimeToSongTick(cycle, 10.5), 240);
});
for (const path of ['Stop', 'limit', 'unmount', 'pagehide', 'context failure', 'copy', 'export', 'navigation']) test(`${path} finalization ends held keys and is synchronous and idempotent`, () => {
  const doc = empty(), capture = createRecording(doc, 't2', 0, { snap: 240 }); let calls = 0;
  capture.on('a', 48, 90, 61);
  const next = capture.finalize(doc, 600, () => { calls++; return true; });
  assert.deepEqual(next.clips.c1.notes, [[0, 539, 48, 90]]);
  assert.equal(capture.finalize(next, 700, () => { calls++; return true; }), next); assert.equal(calls, 1);
});
test('notes in bars 1 and 65 partition into consecutive bounded clips', () => {
  const doc = empty(); doc.tempo.bpm = 240;
  const next = commitTake(doc, take([note(0), note(64 * BAR)]));
  assert.equal(next.tracks[1].regions.length, 2); assert.equal(Object.keys(next.clips).length, 2);
  assert.equal(next.tracks[1].regions[1].start, 64 * BAR); assert.equal(validateBeat(next).ok, true);
});
test('2,500 onsets partition losslessly at bar lines; cumulative density forces a sustaining note cut', () => {
  const notes = Array.from({ length: 3000 }, (_, i) => note(Math.floor(i / 1500) * BAR + Math.floor(i % 1500 / 88) * 60, 21 + i % 88, i === 0 ? 2 * BAR : 30));
  const messages = [], groups = partitionTake(notes, 0, 512 * BAR, (m) => messages.push(m));
  assert.equal(groups.length, 2); assert.equal(groups[0].end, BAR); assert.equal(groups[1].start, BAR);
  assert.equal(groups.flatMap((g) => g.notes).length, 3000); assert.equal(groups[0].notes[0].end, BAR);
  assert.equal(messages.length, 1);
  const next = commitTake(empty(), take(notes.slice(0, 2500))); assert.equal(Object.values(next.clips).reduce((n, c) => n + c.notes.length, 0), 2500);
});
test('held notes stop at 64 bars with announcement; free lines preferred and forced cuts announced', () => {
  const doc = empty(); doc.tempo.bpm = 240; const messages = [], capture = createRecording(doc, 't2', 0, { announce: (m) => messages.push(m) });
  capture.on('held', 60, 100, 0); capture.update(70 * BAR);
  assert.equal(capture.take.notes[0].end, 64 * BAR); assert.equal(capture.held.size, 0); assert.ok(messages.includes('Held note ended at 64 bars'));
  const free = partitionTake([note(0), note(63 * BAR, 60, 2 * BAR), note(65 * BAR)], 0, 100 * BAR);
  assert.equal(free[1].start, 63 * BAR);
  const forced = [], groups = partitionTake([note(0, 60, 64 * BAR), note(63 * BAR, 62, 2 * BAR), note(65 * BAR)], 0, 100 * BAR, (m) => forced.push(m));
  assert.equal(groups[0].end, 64 * BAR); assert.equal(forced.length, 1);
});
test('2,001st onset in a bar refused; next bar can record; clip/region capacity is reserved', () => {
  const doc = empty(), messages = [], capture = createRecording(doc, 't2', 0, { announce: (m) => messages.push(m) });
  for (let i = 0; i < 2000; i++) { assert.equal(capture.on(`n${i}`, 21 + i % 88, 100, Math.floor(i / 88) * 60), true); capture.off(`n${i}`, Math.floor(i / 88) * 60 + 30); }
  assert.equal(capture.on('overflow', 60, 100, 3000), false); assert.equal(capture.on('next', 60, 100, BAR), true);
  assert.ok(messages.some((m) => m.includes('2,000')));
  const full = empty(); for (let i = 1; i <= 63; i++) full.clips[`c${i}`] = { name: 'Reserved', lengthTicks: BAR, notes: [] };
  const reserved = createRecording(full, 't2', 0); reserved.on('first', 60, 100, 0); reserved.off('first', 240);
  assert.equal(reserved.on('second', 60, 100, 64 * BAR), false); assert.equal(reserved.accepting, false);
});
test('project note cap stops capture; refusal retains pending notes; final end is capped', () => {
  const doc = empty();
  for (let c = 1; c <= 3; c++) doc.clips[`c${c}`] = { name: 'Full', lengthTicks: 64 * BAR, notes: Array.from({ length: c === 3 ? 1000 : 2000 }, (_, i) => [i * 60, 30, 60, 100]) };
  const full = createRecording(doc, 't2', 0); assert.equal(full.on('x', 48, 100, 0), false);
  const capture = createRecording(empty(), 't2', 0); capture.on('x', 48, 100, 0);
  const wrong = empty(); wrong.tracks[1].kind = 'audio'; delete wrong.tracks[1].instrument;
  assert.equal(capture.finalize(wrong, 240, () => true), wrong); assert.ok(capture.error); assert.equal(capture.take.notes.length, 1);
  assert.equal(capture.finalize(empty(), 240, () => true).clips.c1.notes.length, 1);
  const end = recordingEndTick(92), next = commitTake(empty(), take([note(end - 240)], { startTick: end - BAR, endLimit: end }));
  assert.equal(next.tracks[1].regions.at(-1).start + next.tracks[1].regions.at(-1).length, end);
});
test('live mix edits do not restart the recording scheduler or mutate the pending document', () => {
  let doc = empty(), now = 0; const capture = createRecording(doc, 't2', 0); const steps = [];
  const scheduler = createScheduler({ clock: () => now, setTimer: () => 1, clearTimer() {}, isHidden: () => false, onEvent() {}, onStep: (step) => steps.push(step), getSequence: () => recordingSequence(doc, 0) });
  scheduler.start(0.03); capture.on('a', 48, 100, 0); doc = setTrackMute(doc, 't1', true);
  for (let i = 0; i < 20; i++) { now += 0.025; scheduler.refill(); }
  assert.equal(steps.filter((step) => step === 0).length, 1); assert.deepEqual(doc.clips, {}); assert.deepEqual(doc.tracks[1].instrument, bass); scheduler.stop();
});
test('refused take recovery survives navigation without writing an invalid beat', async () => {
  const { rememberTake, readPendingTake, forgetTake } = await import('../app/veyrnox/_lib/music/beat/beatPendingTake.mjs');
  const values = new Map(), storage = { setItem: (k, v) => values.set(k, v), getItem: (k) => values.get(k), removeItem: (k) => values.delete(k) };
  const capture = createRecording(empty(), 't2', 0); capture.on('held', 60, 100, 0); capture.off('held', 240);
  assert.equal(rememberTake('beat', capture.take, storage), true);
  assert.deepEqual(readPendingTake('beat', storage), capture.take);
  forgetTake('beat', storage); assert.equal(readPendingTake('beat', storage), null); assert.equal(values.size, 0);
});
test('recording edit policy admits live mix and atomic commit, refusing late library adds and undo', async () => {
  const { recordingEditAllowed, RECORDING_LOCK_REASON } = await import('../app/veyrnox/_lib/music/beat/beatRecordingPolicy.mjs');
  assert.equal(RECORDING_LOCK_REASON, 'Stop recording to edit');
  for (const label of ['add audio region', 'add MIDI track', 'change tempo', 'move region', 'undo', 'redo']) assert.equal(recordingEditAllowed(true, { label }), false);
  assert.equal(recordingEditAllowed(true, { liveMix: true }), true); assert.equal(recordingEditAllowed(true, { recordingCommit: true }), true);
  assert.equal(recordingEditAllowed(false, { label: 'add MIDI track' }), true);
});
test('impossible sub-30-tick forced cuts retain the original take rather than silently deleting a note', () => {
  const doc = empty(), notes = Array.from({ length: 2500 }, (_, i) => note(Math.floor(i / 1500) * BAR + Math.floor(i % 1500 / 88) * 60, 21 + i % 88, 30));
  notes.push(note(BAR - 10, 108, 60));
  const capture = createRecording(doc, 't2', 0); capture.take.notes = notes;
  const before = structuredClone(capture.take);
  assert.equal(capture.finalize(doc, BAR * 2, () => true), doc);
  assert.match(capture.error, /boundary/); assert.deepEqual(capture.take, before);
});
test('recording in a partial-bar gap commits after the existing region without overwriting it', () => {
  const doc = midiDoc(); doc.tracks[1].regions[0].length = 240;
  const capture = createRecording(doc, 't2', 0);
  assert.equal(capture.on('gap', 60, 100, 480), true); capture.off('gap', 720);
  const next = capture.finalize(doc, 960, () => true);
  assert.equal(capture.error, null); assert.equal(validateBeat(next).ok, true);
  assert.deepEqual(next.tracks[1].regions[0], doc.tracks[1].regions[0]);
  const region = next.tracks[1].regions[1];
  assert.equal(region.start, 240); assert.equal(region.start + region.length, BAR);
  assert.deepEqual(next.clips[region.clipId].notes, [[240, 240, 60, 100]]);
});
test('partial-bar gaps partition at subsequent bar lines within the 64-bar cap', () => {
  const groups = partitionTake([note(480), note(64 * BAR)], 240, 100 * BAR);
  assert.equal(groups[0].start, 240); assert.equal(groups[1].start, 64 * BAR);
  assert.ok(groups.every((g) => g.end - g.start <= 64 * BAR));
  const dense = Array.from({ length: 2500 }, (_, i) => note(Math.floor(i / 1500) * BAR + 480 + Math.floor(i % 1500 / 88) * 60, 21 + i % 88, 30));
  const partitioned = partitionTake(dense, 240, 100 * BAR);
  assert.equal(partitioned[1].start, BAR);
  assert.equal(partitioned.flatMap((g) => g.notes).length, 2500);
});
test('saving a take as a new beat keeps source timing and track mix', () => {
  const source = empty(); source.tempo.bpm = 137; source.swing = 0.4; source.steps = 32;
  source.tracks[1].gain = 0.6; source.tracks[1].pan = -0.3;
  const capture = createRecording(source, 't2', 0);
  capture.on('a', 48, 90, 240); capture.off('a', 720);
  const saved = takeAsNewBeat(source, capture.take, { id: 'a40439d1-646a-4c11-9c12-69fa3a851234', now: 1000 });
  assert.equal(validateBeat(saved).ok, true);
  for (const field of ['tempo', 'swing', 'signature', 'steps']) assert.deepEqual(saved[field], source[field]);
  assert.equal(saved.tracks[0].gain, 0.6); assert.equal(saved.tracks[0].pan, -0.3);
  assert.deepEqual(saved.clips.c1.notes, [[240, 480, 48, 90]]);
  assert.notEqual(saved.tempo, source.tempo); assert.notEqual(saved.signature, source.signature);
});
test('unquantised overlapping loop onsets refuse atomically; take remains available for a separate beat', () => {
  const doc = midiDoc([[0, 240, 60, 100]]), capture = createRecording(doc, 't2', 0);
  capture.on('same', 60, 80, 0); capture.off('same', 240);
  assert.equal(capture.finalize(doc, 480, () => true), doc); assert.match(capture.error, /same clip position/); assert.equal(capture.take.notes.length, 1);
});
