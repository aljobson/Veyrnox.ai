import { PRESETS } from '../../../../../lib/musicInstruments.js';
export const MIDI_LIMITS = Object.freeze({ clips: 64, clipNotes: 2000, notes: 5000, clipTicks: 64 * 3840 });
export const GM_PADS = Object.freeze({ kick: 36, snare: 38, hat: 42, openhat: 46, clap: 39, tom: 45, rim: 37, crash: 49 });
export const GM_NOTES = Object.freeze(Object.fromEntries(Object.entries(GM_PADS).map(([pad, pitch]) => [pitch, pad])));
const exact = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));
export const validInstrument = (v) => exact(v, ['engine', 'id', 'preset']) && (v.engine === 'voice'
  ? !!PRESETS[v.id]?.some((p) => p.id === v.preset)
  : v.engine === 'wavetable' && v.id === 'wavetable' && ['glass', 'pad', 'bass'].includes(v.preset));
export const noteCount = (doc) => Object.values(doc.clips || {}).reduce((n, clip) => n + clip.notes.length, 0);
export function clipsError(clips) {
  if (!clips || typeof clips !== 'object' || Array.isArray(clips)) return 'Invalid MIDI clips.';
  if (Object.keys(clips).length > 64) return 'A song can have at most 64 clips.';
  let total = 0;
  for (const [id, clip] of Object.entries(clips)) {
    if (!/^c[0-9a-z]{1,12}$/.test(id) || !exact(clip, ['name', 'lengthTicks', 'notes']) || typeof clip.name !== 'string' || !clip.name.trim() || clip.name.length > 80 ||
      !Number.isInteger(clip.lengthTicks) || clip.lengthTicks < 240 || clip.lengthTicks > MIDI_LIMITS.clipTicks || clip.lengthTicks % 240 || !Array.isArray(clip.notes)) return 'Invalid MIDI clip.';
    if (clip.notes.length > 2000) return 'A clip can have at most 2,000 notes.';
    total += clip.notes.length;
    let previous = [-1, 0, -1];
    for (const note of clip.notes) {
      if (!Array.isArray(note) || note.length !== 4 || note.some((n) => !Number.isInteger(n))) return 'Invalid MIDI note.';
      const [start, length, pitch, velocity] = note;
      if (start < 0 || length < 30 || start + length > clip.lengthTicks || pitch < 21 || pitch > 108 || velocity < 1 || velocity > 127 ||
        start < previous[0] || (start === previous[0] && pitch <= previous[2])) return 'Invalid or duplicate MIDI note.';
      previous = note;
    }
  }
  return total > 5000 ? 'A project can have at most 5,000 notes.' : null;
}
export const validMidiRegion = (r, clip) => !!clip && exact(r, ['id', 'start', 'length', 'clipId', 'phaseTicks']) && Number.isInteger(r.phaseTicks) && r.phaseTicks >= 0 && r.phaseTicks < clip.lengthTicks;
export const noteKey = (note) => `${note[0]}:${note[2]}`;
export function clipLengthFromBars(draft) {
  if (!String(draft).trim() || !Number.isFinite(Number(draft))) return null;
  return Math.max(240, Math.min(MIDI_LIMITS.clipTicks, Math.round(Number(draft) * 3840 / 240) * 240));
}
export function quantisedSelection(clip, keys, snap, strength) {
  const selected = new Set(keys);
  return [...new Set(clip.notes.filter((n) => selected.has(noteKey(n))).map((n) => noteKey(quantisedNote(n, clip.lengthTicks, snap, strength))))];
}
export const sortNotes = (notes) => notes.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
// Selection priority is retained separately from the transformed tuple.
export function resolveNotes(entries) {
  const winners = new Map();
  for (const entry of entries) {
    const key = noteKey(entry.note), old = winners.get(key);
    const rank = (a, b) => Number(a.selected) - Number(b.selected) || a.note[3] - b.note[3] || a.note[1] - b.note[1] || b.original - a.original;
    if (!old || rank(entry, old) > 0) winners.set(key, entry);
  }
  return sortNotes([...winners.values()].map((e) => e.note));
}
export function quantisedNote(note, lengthTicks, snap, strength = 1, quantiseLength = true) {
  const [start, len, pitch, velocity] = note;
  if (!(snap > 0)) return [...note];
  const next = Math.max(0, Math.min(lengthTicks - 30, Math.round(start + strength * (Math.round(start / snap) * snap - start))));
  const length = quantiseLength && len >= snap / 2 ? Math.max(30, Math.round(len / snap) * snap) : Math.max(30, len);
  return [next, Math.min(length, lengthTicks - next), pitch, velocity];
}
