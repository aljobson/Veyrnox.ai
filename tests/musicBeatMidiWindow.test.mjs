import test from 'node:test';
import assert from 'node:assert/strict';
import { midiDoc } from './musicBeatMidiFixtures.mjs';
import { midiNoteOnsInWindow, contextTimeToSongTick } from '../app/veyrnox/_lib/music/beat/beatMidiWindow.mjs';
import { songWindowToContext } from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
import { effectiveGain } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
import { createScheduler } from '../app/veyrnox/_lib/music/beat/beatScheduler.mjs';
import { sequenceFor } from '../app/veyrnox/_lib/music/beat/beatSequence.mjs';
test('partitioned windows equal the whole range including swing, phase, repeats and seams', () => {
  const doc = midiDoc([[0, 480, 60, 100], [240, 240, 62, 90], [241, 30, 64, 80], [3600, 240, 65, 70]]);
  doc.swing = 0.6; Object.assign(doc.tracks[1].regions[0], { start: 240, phaseTicks: 240, length: 4 * 3840 });
  const whole = midiNoteOnsInWindow(doc, 0, 12), windows = [];
  for (let i = 0; i < 120; i++) windows.push(...midiNoteOnsInWindow(doc, i / 10, (i + 1) / 10));
  assert.deepEqual(windows, whole);
  assert.equal(whole[1].songTimeSec, 0.1625); // absolute odd step, despite clip phase
  assert.equal(whole[0].songTimeSec, 241 / 1920); // off-grid remains straight (sorted before swung note)
});
test('locator and cycle starts do not re-trigger already sounding notes', () => {
  const doc = midiDoc([[0, 1920, 60, 100], [1920, 960, 62, 100]]);
  assert.equal(midiNoteOnsInWindow(doc, 0.5, 1).length, 0);
  const map = { contextStart: 10, startSec: 0.5, cycle: { start: 0.5, end: 1.5 } };
  const windows = songWindowToContext(0, 3, map);
  assert.deepEqual(windows.map((w) => midiNoteOnsInWindow(doc, w.fromSec, w.toSec).map((n) => n.pitch)), [[62], [62], [62]]);
  for (const w of windows) assert.equal(contextTimeToSongTick({ contextStart: 10, startTick: 960, tempo: 120, cycle: { start: 960, end: 2880 } }, w.contextTime), Math.round(w.fromSec * 1920));
});
test('gain policy distinguishes song/recording and pattern; scheduler still emits muted MIDI', () => {
  const doc = midiDoc([[0, 240, 60, 100]]); doc.tracks[1].mute = true;
  assert.equal(effectiveGain(doc, 't2', 'song'), 0); assert.equal(effectiveGain(doc, 't2', 'pattern'), 1);
  assert.equal(midiNoteOnsInWindow(doc, 0, 1).length, 0);
  const events = []; const scheduler = createScheduler({ clock: () => 0, setTimer: () => 1, clearTimer() {}, isHidden: () => false, onEvent() {}, onStep() {}, onMidi: (n) => events.push(n), getSequence: () => sequenceFor(doc) });
  scheduler.start(0.03); scheduler.refill(); assert.equal(events.length, 1); scheduler.stop();
  doc.tracks[1].mute = false; doc.tracks[0].solo = true; assert.equal(effectiveGain(doc, 't2', 'song'), 0);
  doc.tracks[1].solo = true; doc.tracks[1].gain = 0.4; assert.equal(effectiveGain(doc, 't2', 'song'), 0.4);
});
test('pattern preview schedules only the edit MIDI track and ignores its mute/solo', () => {
  const doc = midiDoc([[0, 240, 60, 100]]); doc.view = 'pattern'; doc.tracks[1].mute = true; doc.tracks[0].solo = true;
  const sequence = sequenceFor(doc, 0, 't2');
  assert.deepEqual(sequence.doc.tracks.map((t) => t.id), ['t2']); assert.equal(effectiveGain(doc, 't2', 'pattern'), 1);
  const notes = [], drums = [];
  const scheduler = createScheduler({ clock: () => 0, setTimer: () => 1, clearTimer() {}, isHidden: () => false, onEvent: (n) => drums.push(n), onStep() {}, onMidi: (n) => notes.push(n), getSequence: () => sequence });
  scheduler.start(0.03); assert.equal(notes.length, 1); assert.equal(drums.length, 0); scheduler.stop();
});
test('MIDI scheduler schedules each swung note once through repeated cycle wraps', () => {
  const doc = midiDoc([[240, 480, 60, 100], [480, 30, 62, 100], [721, 30, 64, 100]]);
  doc.swing = 0.6; doc.cycle = { on: true, start: 240, end: 1200 };
  let now = 0; const actual = [];
  const scheduler = createScheduler({ clock: () => now, setTimer: () => 1, clearTimer() {}, isHidden: () => false, onEvent() {}, onStep() {}, onMidi: (note, time) => actual.push({ pitch: note.pitch, time }), getSequence: () => sequenceFor(doc) });
  scheduler.start(0.03);
  for (let i = 0; i < 400; i++) { now += 0.025; scheduler.refill(); }
  const expected = [];
  for (const window of songWindowToContext(0, now + 0.15 - 0.03, { startSec: 0.125, contextStart: 0.03, cycle: { start: 0.125, end: 0.625 } })) {
    for (const note of midiNoteOnsInWindow(doc, window.fromSec, window.toSec)) expected.push({ pitch: note.pitch, time: window.contextTime + note.songTimeSec - window.fromSec });
  }
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) => { assert.equal(n.pitch, expected[i].pitch); assert.ok(Math.abs(n.time - expected[i].time) < 1e-8); }); scheduler.stop();
});
