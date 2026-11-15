import test from 'node:test';
import assert from 'node:assert/strict';
import { make } from './musicBeatFixtures.mjs';
import { convertDrums } from '../app/veyrnox/_lib/music/beat/beatMidiOps.mjs';
import { eventsAtStep } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
import { midiNoteOnsInWindow } from '../app/veyrnox/_lib/music/beat/beatMidiWindow.mjs';
import { GM_NOTES } from '../app/veyrnox/_lib/music/beat/beatMidiRules.mjs';
import { eventTime } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
import { moveRegion } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { voiceEnvelopePlan } from '../app/veyrnox/_lib/music/beat/beatVoiceTiming.mjs';
test('converted drums match original onset times, pads and velocities across parity, phase and moves', () => {
  for (const start of [0, 240]) for (const offset of [0, 720]) for (const move of [0, 240]) {
    const doc = make(); doc.tempo.bpm = 120; doc.swing = 0.6; Object.assign(doc.tracks[0].regions[0], { start, offset });
    let converted = convertDrums(doc, 'r1'); const region = converted.tracks[1].regions[0];
    converted = moveRegion(converted, region.id, start + move, 't2');
    const original = moveRegion(doc, 'r1', start + move, 't1');
    const drum = []; for (let step = 0; step < 80; step++) for (const e of eventsAtStep(original, step)) drum.push({ pad: e.pad, time: eventTime(step / 8, step, 120, 0.6), velocity: e.velocity });
    const midi = midiNoteOnsInWindow(converted, 0, 10).map((e) => ({ pad: GM_NOTES[e.pitch], time: e.songTimeSec, velocity: e.velocity / 127 }));
    const sort = (a, b) => a.time - b.time || a.pad.localeCompare(b.pad);
    assert.deepEqual(midi.sort(sort), drum.sort(sort)); assert.equal(converted.tracks[0].mute, true);
  }
});
test('808 kick and open hat retain the original drumVoice gain envelopes regardless of note-off', () => {
  for (const [pad, peak, attack, decay] of [['kick', 0.95, 0.003, 0.28 * 1.8], ['openhat', 0.26, 0.002, 0.32 * 1.8]]) {
    const expected = [['setValueAtTime', 0.0001, 1], ['exponentialRampToValueAtTime', peak, 1 + attack], ['exponentialRampToValueAtTime', 0.0001, 1 + attack + decay]];
    assert.deepEqual(voiceEnvelopePlan('drums', '808', 1, 1.01, pad), expected); assert.deepEqual(voiceEnvelopePlan('drums', '808', 1, 5, pad), expected);
  }
});
