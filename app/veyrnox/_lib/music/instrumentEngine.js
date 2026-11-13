import { DRUM_PADS, GUITAR_STRINGS, SAMPLE_RATE, getPreset, midiToFrequency, normalizeTake } from '../../../../lib/musicInstruments.js';

// Voices take (context, output, noise, ...) so the same code plays live and renders offline.

export function makeNoise(context, seconds = 1) {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function envelope(param, at, peak, attack, hold, release) {
  param.cancelScheduledValues(at);
  param.setValueAtTime(0.0001, at);
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  if (hold > 0) param.setValueAtTime(Math.max(0.0002, peak), at + attack + hold);
  param.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
}

function osc(context, out, type, frequency, at, length, peak, attack = 0.006, release = length) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, at);
  envelope(gain.gain, at, peak, attack, 0, release);
  oscillator.connect(gain).connect(out);
  oscillator.start(at);
  oscillator.stop(at + attack + release + 0.05);
  return oscillator;
}

function pianoVoice(context, out, preset, note, at, dur, vel) {
  const base = midiToFrequency(note);
  const decay = preset.decay || Math.max(dur, 0.3);
  const partials = [[1, 1], [2, 0.38 * preset.bright + 0.1], [3, 0.2 * preset.bright], [4, 0.1 * preset.bright]];
  const bus = context.createGain();
  bus.gain.value = 0.32 * vel;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800 + 7000 * preset.bright;
  bus.connect(filter).connect(out);
  partials.forEach(([ratio, level]) => {
    const type = preset.id === 'organ' ? 'sine' : ratio === 1 ? 'triangle' : 'sine';
    if (preset.id === 'organ') {
      const o = osc(context, bus, type, base * ratio, at, dur, level * 0.8, 0.012, 0.08);
      o.stop(at + dur + 0.1);
    } else osc(context, bus, type, base * ratio, at, decay, level, 0.004, decay);
  });
  if (preset.tremolo) {
    const lfo = context.createOscillator();
    const depth = context.createGain();
    lfo.frequency.value = preset.tremolo;
    depth.gain.value = 0.12 * vel;
    lfo.connect(depth).connect(bus.gain);
    lfo.start(at);
    lfo.stop(at + decay + 0.1);
  }
}

function guitarVoice(context, out, noise, preset, note, at, vel) {
  // Karplus-Strong: a noise burst circulating through a damped delay line.
  const frequency = midiToFrequency(note);
  const source = context.createBufferSource();
  const delay = context.createDelay(0.1);
  const feedback = context.createGain();
  const damping = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = noise;
  delay.delayTime.value = 1 / frequency;
  feedback.gain.value = preset.sustain;
  damping.type = 'lowpass';
  damping.frequency.value = preset.tone;
  gain.gain.value = 0.55 * vel;
  const burst = context.createGain();
  burst.gain.setValueAtTime(1, at);
  burst.gain.setValueAtTime(0, at + 1 / frequency);
  source.connect(burst).connect(delay);
  delay.connect(damping).connect(feedback).connect(delay);
  let tail = damping;
  if (preset.drive > 0) {
    const shaper = context.createWaveShaper();
    const curve = new Float32Array(256);
    const k = 4 + preset.drive * 60;
    for (let i = 0; i < 256; i += 1) { const x = (i / 255) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    shaper.curve = curve;
    damping.connect(shaper);
    tail = shaper;
  }
  tail.connect(gain).connect(out);
  source.start(at);
  source.stop(at + 0.05);
  const end = at + 2.6;
  gain.gain.setValueAtTime(0.55 * vel, end - 0.4);
  gain.gain.linearRampToValueAtTime(0, end);
  feedback.gain.setValueAtTime(preset.sustain, end - 0.4);
  feedback.gain.linearRampToValueAtTime(0, end);
}

function noiseHit(context, out, noise, at, length, peak, type, freq) {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = noise;
  filter.type = type;
  filter.frequency.value = freq;
  envelope(gain.gain, at, peak, 0.002, 0, length);
  source.connect(filter).connect(gain).connect(out);
  source.start(at);
  source.stop(at + length + 0.05);
}

function sweep(context, out, at, from, to, length, peak) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.setValueAtTime(from, at);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + length * 0.5);
  envelope(gain.gain, at, peak, 0.003, 0, length);
  oscillator.connect(gain).connect(out);
  oscillator.start(at);
  oscillator.stop(at + length + 0.05);
}

function drumVoice(context, out, noise, preset, pad, at, vel) {
  const p = preset.pitch;
  const d = preset.decay;
  if (pad === 'kick') sweep(context, out, at, 160 * p, 45 * p, 0.28 * d, 0.95 * vel);
  else if (pad === 'snare') { sweep(context, out, at, 220 * p, 150 * p, 0.12, 0.35 * vel); noiseHit(context, out, noise, at, 0.18 * d, (0.35 + preset.snap * 0.3) * vel, 'highpass', 1400); }
  else if (pad === 'hat') noiseHit(context, out, noise, at, 0.05, 0.28 * vel, 'highpass', 7000);
  else if (pad === 'openhat') noiseHit(context, out, noise, at, 0.32 * d, 0.26 * vel, 'highpass', 6500);
  else if (pad === 'clap') { [0, 0.012, 0.026].forEach((o) => noiseHit(context, out, noise, at + o, 0.09, 0.3 * vel, 'bandpass', 1500)); }
  else if (pad === 'tom') sweep(context, out, at, 200 * p, 90 * p, 0.35 * d, 0.6 * vel);
  else if (pad === 'rim') { sweep(context, out, at, 800, 600, 0.04, 0.35 * vel); noiseHit(context, out, noise, at, 0.03, 0.2 * vel, 'highpass', 3000); }
  else if (pad === 'crash') noiseHit(context, out, noise, at, 1.4 * d, 0.3 * vel, 'highpass', 4500);
}

function synthLike(context, out, preset, note, at, dur, vel, bass) {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  oscillator.type = preset.wave;
  oscillator.frequency.value = midiToFrequency(note);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(preset.cutoff, at);
  const attack = bass ? 0.006 : preset.attack;
  const release = bass ? preset.decay : preset.release;
  const hold = bass ? 0 : Math.max(0, dur - attack);
  if (bass) filter.frequency.exponentialRampToValueAtTime(Math.max(120, preset.cutoff * 0.25), at + preset.decay);
  envelope(gain.gain, at, 0.4 * vel, attack, hold, release);
  oscillator.connect(filter).connect(gain).connect(out);
  oscillator.start(at);
  oscillator.stop(at + attack + hold + release + 0.05);
}

/** Schedule one gesture on any (live or offline) context. */
export function playEvent(context, out, noise, instrument, presetId, event, at) {
  const preset = getPreset(instrument, presetId);
  if (instrument === 'piano') pianoVoice(context, out, preset, event.value, at, event.dur, event.vel);
  else if (instrument === 'guitar') guitarVoice(context, out, noise, preset, event.value, at, event.vel);
  else if (instrument === 'drums') drumVoice(context, out, noise, preset, event.value, at, event.vel);
  else synthLike(context, out, preset, event.value, at, event.dur, event.vel, instrument === 'bass');
}

export function strumNotes(frets) {
  return frets.map((fret, string) => (fret < 0 ? null : GUITAR_STRINGS[string] + fret));
}

/** Render a take offline to mono samples. Returns { samples, sampleRate }. */
export async function renderTake(rawTake) {
  const take = normalizeTake(rawTake);
  if (!take) throw new Error('empty_take');
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error('audio_unavailable');
  const tail = take.instrument === 'guitar' ? 2.4 : 1.2;
  const context = new Offline(1, Math.ceil((take.length + tail) * SAMPLE_RATE), SAMPLE_RATE);
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  master.gain.value = 0.8;
  master.connect(compressor).connect(context.destination);
  const noise = makeNoise(context);
  take.events.forEach((event) => playEvent(context, master, noise, take.instrument, take.preset, event, event.at));
  const rendered = await context.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate: rendered.sampleRate };
}

export { DRUM_PADS };
