import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRUM_PADS, GUITAR_CHORDS, INSTRUMENT_IDS, PRESETS, chordNotes, encodeWav, keyRange, midiToFrequency,
  normalizeTake, normalizeTakeEvent, noteLabel, trimSamples,
} from '../lib/musicInstruments.js';

test('A4 is 440 Hz and labels are readable', () => {
  assert.equal(midiToFrequency(69), 440);
  assert.equal(noteLabel(60), 'C4');
});

test('every instrument has at least one preset and keys have a range', () => {
  for (const id of INSTRUMENT_IDS) assert.ok(PRESETS[id].length > 0);
  assert.equal(keyRange('piano').length, 25);
  assert.deepEqual(keyRange('drums'), []);
});

test('guitar chords skip muted strings', () => {
  const am = GUITAR_CHORDS.find((c) => c.id === 'Am');
  assert.equal(chordNotes(am).length, 5);
});

test('take events are clamped and bad ones dropped', () => {
  assert.equal(normalizeTakeEvent({ at: 1, value: 'kick' }, 'drums').value, 'kick');
  assert.equal(normalizeTakeEvent({ at: 1, value: 'cowbell' }, 'drums'), null);
  assert.equal(normalizeTakeEvent({ at: 'x', value: 60 }, 'piano'), null);
  assert.equal(normalizeTakeEvent({ at: 1, value: 999 }, 'piano').value, 108);
});

test('normalizeTake sorts events, falls back to the first preset and rejects empty takes', () => {
  const take = normalizeTake({ instrument: 'piano', preset: 'nope', events: [{ at: 2, value: 62 }, { at: 1, value: 60 }] });
  assert.equal(take.preset, 'grand');
  assert.deepEqual(take.events.map((e) => e.value), [60, 62]);
  assert.equal(normalizeTake({ instrument: 'piano', events: [] }), null);
  assert.equal(normalizeTake({ instrument: 'kazoo', events: [{ at: 0, value: 60 }] }), null);
  assert.ok(DRUM_PADS.length >= 8);
});

test('trimSamples cuts and fades the edges', () => {
  const rate = 1000;
  const out = trimSamples(new Float32Array(2000).fill(1), rate, 0.5, 1.5);
  assert.equal(out.length, 1000);
  assert.equal(out[0], 0);
  assert.equal(out[500], 1);
});

test('encodeWav writes a valid 16-bit mono header', () => {
  const buffer = encodeWav(new Float32Array([0, 1, -1]), 44100);
  const view = new DataView(buffer);
  assert.equal(buffer.byteLength, 44 + 6);
  assert.equal(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF');
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), -32768);
});
