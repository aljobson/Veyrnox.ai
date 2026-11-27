import { normalizeMusicSampleMix } from '../../../../lib/musicDiscover.js';

export const MUSIC_SAMPLE_PREVIEW_SECONDS = 12;

function ramp(param, start, peak, end, value) {
  param.setValueAtTime(0.0001, start);
  param.exponentialRampToValueAtTime(Math.max(0.0001, value), peak);
  param.exponentialRampToValueAtTime(0.0001, end);
}

function tone(context, output, frequency, start, length, type, volume) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  ramp(gain.gain, start, start + 0.015, start + length, volume);
  oscillator.connect(gain).connect(output);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

function kick(context, output, start, volume = 0.5) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.setValueAtTime(145, start);
  oscillator.frequency.exponentialRampToValueAtTime(48, start + 0.12);
  ramp(gain.gain, start, start + 0.005, start + 0.2, volume);
  oscillator.connect(gain).connect(output);
  oscillator.start(start);
  oscillator.stop(start + 0.22);
}

function noiseHit(context, output, buffer, start, length, volume, highpass) {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = 'highpass';
  filter.frequency.value = highpass;
  ramp(gain.gain, start, start + 0.003, start + length, volume);
  source.connect(filter).connect(gain).connect(output);
  source.start(start);
  source.stop(start + length + 0.02);
}

function makeNoise(context) {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

export function scheduleMusicSamplePreview(beat, rawMix, onProgress, onEnded) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error('audio_unavailable');
  const mix = normalizeMusicSampleMix(rawMix);
  const context = new AudioContext();
  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();
  const drums = context.createGain();
  const bass = context.createGain();
  const melody = context.createGain();
  master.gain.value = 0.55;
  drums.gain.value = mix.drums / 100;
  bass.gain.value = mix.bass / 100;
  melody.gain.value = mix.melody / 100;
  drums.connect(master);
  bass.connect(master);
  melody.connect(master);
  master.connect(compressor).connect(context.destination);
  const noise = makeNoise(context);
  const eighth = 30 / (beat.bpm * mix.tempo);
  const start = context.currentTime + 0.08;
  const stepCount = Math.ceil(MUSIC_SAMPLE_PREVIEW_SECONDS / eighth);

  for (let step = 0; step < stepCount; step += 1) {
    const at = start + step * eighth;
    if (step % 4 === 0 || step % 8 === 6) kick(context, drums, at, ['Rock', 'Trap', 'Drum & Bass'].includes(beat.mood) ? 0.7 : 0.48);
    if (step % 8 === 4) noiseHit(context, drums, noise, at, 0.16, 0.22, 900);
    noiseHit(context, drums, noise, at, 0.04, step % 2 ? 0.035 : 0.055, 5000);
    if (step % 2 === 0) {
      const interval = beat.bass[(step / 2) % beat.bass.length];
      tone(context, bass, beat.root * (2 ** (interval / 12)), at, eighth * 1.65, beat.wave, 0.09);
    }
    if (step % 4 === 2) {
      const interval = beat.lead[(step / 2) % beat.lead.length];
      tone(context, melody, beat.root * 2 * (2 ** (interval / 12)), at, eighth * 1.4, beat.wave === 'square' ? 'triangle' : 'sine', 0.035);
    }
    if (step % 8 === 0) {
      [0, 3, 7].forEach((interval, chordIndex) => {
        tone(context, melody, beat.root * 2 * (2 ** (interval / 12)), at + chordIndex * 0.01, eighth * 6.5, 'sine', 0.025);
      });
    }
  }

  const startedAt = window.performance.now();
  const progressTimer = window.setInterval(() => {
    onProgress(Math.min(1, (window.performance.now() - startedAt) / (MUSIC_SAMPLE_PREVIEW_SECONDS * 1000)));
  }, 100);
  const endTimer = window.setTimeout(() => {
    window.clearInterval(progressTimer);
    context.close().catch(() => {});
    onProgress(1);
    onEnded();
  }, MUSIC_SAMPLE_PREVIEW_SECONDS * 1000 + 180);
  return () => {
    window.clearInterval(progressTimer);
    window.clearTimeout(endTimer);
    context.close().catch(() => {});
  };
}
