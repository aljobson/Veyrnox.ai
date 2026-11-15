import { DRUM_PADS } from '../../../../../lib/musicInstruments.js';
export const TYPING_NOTES = Object.freeze({ a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72, o: 73, l: 74, p: 75, ';': 76 });
export function routeBeatKey({ key, repeat, textInput, command, kind, octave = 0, velocity = 100 }) {
  if (repeat || textInput || command) return null;
  key = key.toLowerCase();
  if (kind === 'drums') { const pad = DRUM_PADS.find((p) => p.key === key); return pad ? { type: 'pad', pad: pad.id } : null; }
  if (kind !== 'midi') return null;
  if (key === 'z' || key === 'x') return { type: 'octave', value: Math.max(-3, Math.min(2, octave + (key === 'z' ? -1 : 1))) };
  if (key === 'c' || key === 'v') return { type: 'velocity', value: Math.max(1, Math.min(127, velocity + (key === 'c' ? -16 : 16))) };
  return TYPING_NOTES[key] === undefined ? null : { type: 'note', pitch: TYPING_NOTES[key] + octave * 12, velocity };
}
