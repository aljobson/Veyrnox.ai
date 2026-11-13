// Pure-JS voice renderer: no Web Audio. The phone app plays files, so each note or pad is
// rendered once to PCM here, written as a WAV and replayed from a player pool.
import { encodeWav, getPreset, midiToFrequency } from './musicInstruments.js';

export const SYNTH_RATE = 22050;

function noiseSource(seed = 1) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2147483648 - 1;
  };
}

const buffer = (seconds) => new Float32Array(Math.max(1, Math.floor(seconds * SYNTH_RATE)));
const expDecay = (index, seconds) => Math.exp((-index / SYNTH_RATE) * (6.9 / seconds));
const attackGain = (index, seconds) => Math.min(1, index / Math.max(1, seconds * SYNTH_RATE));

function keysVoice(preset, note, vel, dur) {
  const base = midiToFrequency(note);
  const sustained = !preset.decay;
  const length = sustained ? dur + 0.12 : preset.decay;
  const out = buffer(length);
  const partials = [[1, 1], [2, 0.38 * preset.bright + 0.1], [3, 0.2 * preset.bright], [4, 0.1 * preset.bright]];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SYNTH_RATE;
    let sample = 0;
    for (const [ratio, level] of partials) {
      if (base * ratio < SYNTH_RATE / 2) sample += Math.sin(2 * Math.PI * base * ratio * t) * level;
    }
    const tremolo = preset.tremolo ? 1 - 0.12 * (1 - Math.sin(2 * Math.PI * preset.tremolo * t)) : 1;
    const env = sustained ? Math.min(1, t / 0.012) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.12) : 1) : attackGain(i, 0.004) * expDecay(i, preset.decay);
    out[i] = sample * env * tremolo * 0.3 * vel;
  }
  return out;
}

function guitarVoice(preset, note, vel) {
  const frequency = midiToFrequency(note);
  const period = Math.max(2, Math.round(SYNTH_RATE / frequency));
  const out = buffer(2.4);
  const random = noiseSource(note * 7919);
  const line = new Float32Array(period).map(() => random());
  let previous = 0;
  for (let i = 0; i < out.length; i += 1) {
    const at = i % period;
    const current = line[at];
    const next = (current + previous) * 0.5 * preset.sustain;
    line[at] = next;
    previous = current;
    let sample = current;
    if (preset.drive > 0) sample = Math.tanh(sample * (2 + preset.drive * 10)) * 0.7;
    out[i] = sample * vel * 0.6 * Math.min(1, (out.length - i) / (SYNTH_RATE * 0.3));
  }
  return out;
}

function highpassNoise(random, length, peak, decay, vel) {
  const out = buffer(length);
  let low = 0;
  for (let i = 0; i < out.length; i += 1) {
    const raw = random();
    low += (raw - low) * 0.2;
    out[i] = (raw - low) * peak * vel * attackGain(i, 0.001) * expDecay(i, decay);
  }
  return out;
}

function sweepTone(from, to, length, peak, vel) {
  const out = buffer(length);
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const progress = Math.min(1, i / (out.length * 0.5));
    const frequency = from * (to / from) ** progress;
    phase += (2 * Math.PI * frequency) / SYNTH_RATE;
    out[i] = Math.sin(phase) * peak * vel * attackGain(i, 0.002) * expDecay(i, length);
  }
  return out;
}

function mixInto(target, source, offsetSeconds = 0) {
  const offset = Math.floor(offsetSeconds * SYNTH_RATE);
  for (let i = 0; i < source.length && offset + i < target.length; i += 1) target[offset + i] += source[i];
  return target;
}

function drumVoice(preset, pad, vel) {
  const random = noiseSource(pad.length * 104729);
  const p = preset.pitch;
  const d = preset.decay;
  const sum = (length, ...parts) => parts.reduce((acc, [src, at = 0]) => mixInto(acc, src, at), buffer(length));
  if (pad === 'kick') return sweepTone(160 * p, 45 * p, 0.28 * d, 0.95, vel);
  if (pad === 'snare') return sum(0.2 * d, [sweepTone(220 * p, 150 * p, 0.12, 0.35, vel)], [highpassNoise(random, 0.2 * d, 0.55 + preset.snap * 0.3, 0.18 * d, vel)]);
  if (pad === 'hat') return highpassNoise(random, 0.06, 0.5, 0.05, vel);
  if (pad === 'openhat') return highpassNoise(random, 0.34 * d, 0.45, 0.3 * d, vel);
  if (pad === 'clap') return sum(0.12, [highpassNoise(random, 0.1, 0.5, 0.09, vel)], [highpassNoise(random, 0.1, 0.5, 0.09, vel), 0.012], [highpassNoise(random, 0.1, 0.5, 0.09, vel), 0.026]);
  if (pad === 'tom') return sweepTone(200 * p, 90 * p, 0.35 * d, 0.7, vel);
  if (pad === 'rim') return sum(0.06, [sweepTone(800, 600, 0.04, 0.4, vel)], [highpassNoise(random, 0.04, 0.3, 0.03, vel)]);
  return highpassNoise(random, 1.4 * d, 0.45, 1.2 * d, vel);
}

function waveAt(type, phase) {
  const wrapped = phase % 1;
  if (type === 'sine') return Math.sin(2 * Math.PI * wrapped);
  if (type === 'square') return wrapped < 0.5 ? 0.7 : -0.7;
  if (type === 'triangle') return 4 * Math.abs(wrapped - 0.5) - 1;
  return 2 * wrapped - 1;
}

function synthVoice(preset, note, vel, dur, bass) {
  const frequency = midiToFrequency(note);
  const attack = bass ? 0.006 : preset.attack;
  const release = bass ? preset.decay : preset.release;
  const hold = bass ? 0 : Math.max(0, dur - attack);
  const out = buffer(attack + hold + release);
  let low = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SYNTH_RATE;
    const cutoff = bass ? Math.max(120, preset.cutoff * (1 - 0.75 * Math.min(1, t / preset.decay))) : preset.cutoff;
    const alpha = Math.min(1, (2 * Math.PI * cutoff) / SYNTH_RATE);
    low += (waveAt(preset.wave, frequency * t) - low) * alpha;
    const env = t < attack ? t / attack : t < attack + hold ? 1 : Math.max(0, 1 - (t - attack - hold) / release);
    out[i] = low * env * 0.4 * vel;
  }
  return out;
}

/** Render one note or pad. `value` is a MIDI note (keys, strings) or a pad id (drums). */
export function renderVoice(instrument, presetId, value, vel = 0.85, dur = 0.5) {
  const preset = getPreset(instrument, presetId);
  if (!preset) return new Float32Array(0);
  if (instrument === 'piano') return keysVoice(preset, value, vel, dur);
  if (instrument === 'guitar') return guitarVoice(preset, value, vel);
  if (instrument === 'drums') return drumVoice(preset, value, vel);
  return synthVoice(preset, value, vel, dur, instrument === 'bass');
}

/** Mix a normalised take (see normalizeTake) to mono PCM at SYNTH_RATE. */
export function renderTakeSamples(take) {
  const total = buffer(take.length + (take.instrument === 'guitar' ? 2.4 : 1.2));
  for (const event of take.events) mixInto(total, renderVoice(take.instrument, take.preset, event.value, event.vel, event.dur), event.at);
  let peak = 0;
  for (let i = 0; i < total.length; i += 1) peak = Math.max(peak, Math.abs(total[i]));
  if (peak > 0.95) for (let i = 0; i < total.length; i += 1) total[i] *= 0.95 / peak;
  return total;
}

export function renderVoiceWav(instrument, presetId, value, vel, dur) {
  return encodeWav(renderVoice(instrument, presetId, value, vel, dur), SYNTH_RATE);
}
