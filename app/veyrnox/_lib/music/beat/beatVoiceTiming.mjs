import { getPreset } from '../../../../../lib/musicInstruments.js';
import { WAVETABLE_PRESETS } from './beatWavetable.js';
export function voiceTiming(instrument, presetId) {
  const id = typeof instrument === 'string' ? instrument : instrument.id;
  const preset = id === 'wavetable' ? WAVETABLE_PRESETS[presetId] : getPreset(id, presetId);
  const gated = ['wavetable', 'synth', 'bass'].includes(id) || (id === 'piano' && presetId === 'organ');
  return { id, preset, gated, attack: id === 'bass' ? 0.006 : id === 'piano' ? 0.012 : preset.attack,
    release: id === 'bass' ? preset.decay : id === 'piano' ? 0.08 : preset.release,
    natural: id === 'guitar' ? 2.6 : id === 'piano' ? preset.decay + 0.1 : 1.4 * preset.decay + 0.1 };
}
// Event tuples are [method, value, absolute audio time]. Drum tuples describe
// the original inner envelopes; note-off does not alter them.
export function voiceEnvelopePlan(instrument, presetId, at, releaseAt = Infinity, pad = 'kick') {
  const { id, preset, gated, attack, release, natural } = voiceTiming(instrument, presetId);
  const env = (peak, attackTime, decay, offset = 0) => [
    ['setValueAtTime', 0.0001, at + offset], ['exponentialRampToValueAtTime', peak, at + offset + attackTime],
    ['exponentialRampToValueAtTime', 0.0001, at + offset + attackTime + decay],
  ];
  if (id === 'drums') {
    const d = preset.decay;
    return ({ kick: () => env(0.95, 0.003, 0.28 * d), hat: () => env(0.28, 0.002, 0.05), openhat: () => env(0.26, 0.002, 0.32 * d),
      snare: () => [...env(0.35, 0.003, 0.12), ...env(0.35 + preset.snap * 0.3, 0.002, 0.18 * d)],
      clap: () => [0, 0.012, 0.026].flatMap((offset) => env(0.3, 0.002, 0.09, offset)),
      tom: () => env(0.6, 0.003, 0.35 * d), rim: () => [...env(0.35, 0.003, 0.04), ...env(0.2, 0.002, 0.03)], crash: () => env(0.3, 0.002, 1.4 * d) })[pad]?.() || [];
  }
  if (!gated) return [['setValueAtTime', 1, at], ...(releaseAt < at + natural ? [['setValueAtTime', 1, releaseAt], ['linearRampToValueAtTime', 0, releaseAt + 0.12]] : [])];
  const peakAt = Math.min(at + attack, releaseAt), fraction = Math.max(0, Math.min(1, (peakAt - at) / attack));
  const level = id === 'wavetable' ? Math.max(0.0001, fraction) : 0.0001 ** (1 - fraction);
  const ramp = id === 'wavetable' ? 'linearRampToValueAtTime' : 'exponentialRampToValueAtTime';
  const events = [['setValueAtTime', 0.0001, at], [ramp, level, peakAt]];
  if (Number.isFinite(releaseAt)) events.push(['setValueAtTime', level, releaseAt],
    id === 'wavetable' ? ['setTargetAtTime', 0.0001, releaseAt, Math.max(0.005, release / 3)] : ['exponentialRampToValueAtTime', 0.0001, releaseAt + release]);
  return events;
}
