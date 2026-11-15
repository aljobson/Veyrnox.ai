import { PRESETS } from '../../../../../lib/musicInstruments.js';
const phrase = (notes, spacing = 1, length = 0.75) => notes.map((note, i) => [i * spacing, length, note, 0.7]);
const chord = (at, length, notes) => notes.map((note) => [at, length, note, 0.45]);
export const BEAT_SOUNDS = [
  ['sub-one', 'Bass loop 1', 'Bass', 'bass', 'sub', 1, phrase([33, 33, 40, 43])],
  ['pluck-two', 'Bass loop 2', 'Bass', 'bass', 'pluck', 2, phrase([33, 40, 43, 40, 33, 36, 40, 31])],
  ['acid', 'Acid pulse', 'Bass', 'bass', 'acid', 1, phrase([33, 45, 40, 43, 33, 40, 43, 45], 0.5, 0.3)],
  ['deep', 'Deep bass', 'Bass', 'bass', 'sub', 4, phrase([33, 29, 36, 31], 4, 3.5)],
  ['stabs', 'Minor chord stabs', 'Keys', 'piano', 'grand', 1, [...chord(0, 0.5, [57, 60, 64]), ...chord(2, 0.5, [55, 59, 62])]],
  ['electric', 'Electric chords', 'Keys', 'piano', 'electric', 2, [...chord(0, 3, [57, 60, 64]), ...chord(4, 3, [53, 57, 60])]],
  ['bells', 'Music box', 'Keys', 'piano', 'musicbox', 2, phrase([69, 72, 76, 79, 76, 72, 71, 69])],
  ['organ', 'Organ pulse', 'Keys', 'piano', 'organ', 1, [...chord(0, 1, [57, 60, 64]), ...chord(2, 1, [57, 60, 64])]],
  ['arp', 'Minor arpeggio', 'Synth', 'synth', 'pluck', 2, phrase([57, 60, 64, 69, 64, 60, 57, 64, 55, 59, 62, 67, 62, 59, 55, 62], 0.5, 0.3)],
  ['pad', 'Warm pad', 'Synth', 'synth', 'pad', 4, chord(0, 16, [57, 60, 64])],
  ['lead', 'Minor lead', 'Synth', 'synth', 'lead', 2, phrase([69, 72, 71, 64, 67, 64, 60, 57])],
  ['sweep', 'Rising sweep', 'FX', 'synth', 'pad', 4, phrase([45, 48, 52, 57, 60, 64, 69, 72], 2, 2)],
].map(([id, name, category, instrument, preset, bars, notes]) => ({ id, name, category, instrument, preset, bars, notes }));
export const soundById = (id) => BEAT_SOUNDS.find((sound) => sound.id === id);
export const soundTicks = (id) => (soundById(id)?.bars || 0) * 3840;
export const soundDuration = (id, bpm) => soundTicks(id) / 960 * 60 / bpm;
export function validateSound(sound) {
  return typeof sound?.id === 'string' && !!sound.name && ['Bass', 'Keys', 'Synth', 'FX'].includes(sound.category)
    && !!PRESETS[sound.instrument]?.some((p) => p.id === sound.preset) && [1, 2, 4].includes(sound.bars)
    && Array.isArray(sound.notes) && sound.notes.length > 0 && sound.notes.every((n) => Array.isArray(n) && n.length === 4
      && n.every(Number.isFinite) && n[0] >= 0 && n[1] > 0 && n[0] + n[1] <= sound.bars * 4
      && Number.isInteger(n[2]) && n[2] >= 0 && n[2] <= 127 && n[3] > 0 && n[3] <= 1);
}
