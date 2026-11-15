import { edit, trackById, regionById, nextId, place, BeatRefusal } from './beatOps.mjs';
import { GM_PADS, noteKey, sortNotes, resolveNotes, quantisedNote } from './beatMidiRules.mjs';
import { PRESETS } from '../../../../../lib/musicInstruments.js';
import { WAVETABLE_PRESETS } from './beatWavetable.js';
export const addMidiTrack = (doc, instrument, now = Date.now()) => edit(doc, now, (d) => {
  if (d.tracks.length >= 16) throw new BeatRefusal('A song can have at most 16 tracks.');
  const label = (instrument.engine === 'wavetable' ? WAVETABLE_PRESETS[instrument.preset] : PRESETS[instrument.id]?.find((p) => p.id === instrument.preset))?.label || 'Instrument';
  let name = label, suffix = 2;
  while (d.tracks.some((t) => t.name === name)) name = `${label} ${suffix++}`;
  d.tracks.push({ id: nextId(d, 't'), name, kind: 'midi', instrument: { ...instrument }, mute: false, solo: false, gain: 1, pan: 0, regions: [] });
});
export function insertMidiRegion(d, trackId, start, lengthTicks = 3840, notes = [], name = 'MIDI clip') {
  const track = trackById(d, trackId);
  if (track.kind !== 'midi') throw new BeatRefusal('Choose a MIDI track for this clip.');
  const clipId = nextId(d, 'c');
  d.clips[clipId] = { name, lengthTicks, notes: sortNotes(notes) };
  const region = { id: nextId(d, 'r'), start, length: lengthTicks, clipId, phaseTicks: 0 };
  place(d, track, region);
  return region;
}
export const addMidiRegion = (doc, trackId, start, now = Date.now()) => edit(doc, now, (d) => { insertMidiRegion(d, trackId, start); });
function clipById(d, id) {
  const clip = d.clips?.[id];
  if (!clip) throw new BeatRefusal('That clip no longer exists.');
  return clip;
}
export const addNote = (doc, id, note, now = Date.now()) => edit(doc, now, (d) => {
  const clip = clipById(d, id);
  if (clip.notes.some((n) => noteKey(n) === noteKey(note))) throw new BeatRefusal('There is already a note at that position and pitch.');
  clip.notes = sortNotes([...clip.notes, [...note]]);
});
export const changeNotes = (doc, id, keys, transform, now = Date.now()) => edit(doc, now, (d) => {
  const clip = clipById(d, id), selected = new Set(keys);
  clip.notes = resolveNotes(clip.notes.flatMap((n) => {
    const chosen = selected.has(noteKey(n)), next = chosen ? transform([...n], clip) : n;
    return next ? [{ note: next, selected: chosen, original: n[0] }] : [];
  }));
});
export const deleteNotes = (doc, id, keys, now) => changeNotes(doc, id, keys, () => null, now);
export const moveNotes = (doc, id, keys, tickDelta, pitchDelta, now) => changeNotes(doc, id, keys, (n, c) =>
  [Math.max(0, Math.min(c.lengthTicks - n[1], n[0] + tickDelta)), n[1], Math.max(21, Math.min(108, n[2] + pitchDelta)), n[3]], now);
export const resizeNotes = (doc, id, keys, delta, now) => changeNotes(doc, id, keys, (n, c) => [n[0], Math.max(30, Math.min(c.lengthTicks - n[0], n[1] + delta)), n[2], n[3]], now);
export const velocityNotes = (doc, id, keys, delta, now) => changeNotes(doc, id, keys, (n) => [n[0], n[1], n[2], Math.max(1, Math.min(127, n[3] + delta))], now);
export const quantiseNotes = (doc, id, keys, snap, strength = 1, now) => changeNotes(doc, id,
  keys.length ? keys : clipById(doc, id).notes.map(noteKey), (n, c) => quantisedNote(n, c.lengthTicks, snap, strength), now);
export const setClipLength = (doc, id, lengthTicks, now = Date.now()) => edit(doc, now, (d) => {
  const clip = clipById(d, id);
  if (lengthTicks < clip.lengthTicks) {
    clip.notes = clip.notes.filter((n) => n[0] < lengthTicks - 29).map((n) => [n[0], Math.min(n[1], lengthTicks - n[0]), n[2], n[3]]);
    for (const t of d.tracks) for (const r of t.regions) if (r.clipId === id) r.phaseTicks %= lengthTicks;
  }
  clip.lengthTicks = lengthTicks;
});
export const makeUnique = (doc, regionId, now = Date.now()) => edit(doc, now, (d) => {
  const { region } = regionById(d, regionId), clip = clipById(d, region.clipId), id = nextId(d, 'c');
  d.clips[id] = structuredClone(clip); region.clipId = id;
});
export const convertDrums = (doc, regionId, now = Date.now()) => edit(doc, now, (d) => {
  const { track, region } = regionById(d, regionId);
  if (track.kind !== 'drums') throw new BeatRefusal('Choose a drum region.');
  const notes = Object.entries(d.patterns[region.pattern].rows).flatMap(([pad, hits]) => hits.filter(([s]) => s < d.steps).map(([s, vel]) => [s * 240, 240, GM_PADS[pad], vel]));
  const midi = { id: nextId(d, 't'), name: `${track.name.slice(0, 30)} MIDI`, kind: 'midi', instrument: { engine: 'voice', id: 'drums', preset: track.kit }, mute: false, solo: track.solo, gain: track.gain, pan: track.pan, regions: [] };
  d.tracks.push(midi);
  const added = insertMidiRegion(d, midi.id, region.start, d.steps * 240, notes, `Pattern ${region.pattern}`);
  added.length = region.length; added.phaseTicks = region.offset;
  track.mute = true;
});
