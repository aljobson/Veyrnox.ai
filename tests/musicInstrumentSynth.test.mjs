import test from 'node:test';
import assert from 'node:assert/strict';
import { DRUM_PADS, INSTRUMENT_IDS, PRESETS, normalizeTake } from '../lib/musicInstruments.js';
import { SYNTH_RATE, renderTakeSamples, renderVoice, renderVoiceWav } from '../lib/musicInstrumentSynth.js';

const stats = (data) => {
  let peak = 0; let finite = true;
  for (const v of data) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); }
  return { peak, finite };
};

test('every instrument preset renders audible, finite, bounded audio', () => {
  for (const id of INSTRUMENT_IDS) {
    const values = id === 'drums' ? DRUM_PADS.map((p) => p.id) : [id === 'bass' ? 40 : 60];
    for (const preset of PRESETS[id]) for (const value of values) {
      const { peak, finite } = stats(renderVoice(id, preset.id, value, 0.9, 0.5));
      assert.ok(finite, `${id}/${preset.id}/${value} finite`);
      assert.ok(peak > 0.01 && peak <= 1.2, `${id}/${preset.id}/${value} peak ${peak}`);
    }
  }
});

test('voices are deterministic', () => {
  assert.deepEqual(renderVoice('drums', '808', 'snare', 0.8), renderVoice('drums', '808', 'snare', 0.8));
});

test('a take mixes to normalised audio at the synth rate', () => {
  const take = normalizeTake({ instrument: 'piano', preset: 'grand', events: [{ at: 0, value: 60, dur: 0.4 }, { at: 0.5, value: 64, dur: 0.4 }] });
  const samples = renderTakeSamples(take);
  assert.ok(samples.length >= take.length * SYNTH_RATE);
  assert.ok(stats(samples).peak <= 0.96);
});

test('voice WAV has a valid header at the synth rate', () => {
  const view = new DataView(renderVoiceWav('piano', 'grand', 60, 0.8, 0.4));
  assert.equal(view.getUint32(24, true), SYNTH_RATE);
});
