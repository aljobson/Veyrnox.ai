import { soundDuration, soundTicks } from './beatSounds.mjs';
import { audioFragment, clampFades, tickSeconds } from './beatAudioSegments.mjs';
import { BEAT_LIMITS, validateBeat } from './beatDocument.mjs';
// Beat documents contain only JSON values; object property order is not an edit.
function equalValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalValue(a[key], b[key]));
}
export function edit(doc, now, change) {
  const next = structuredClone(doc);
  change(next);
  if (next.clips) {
    const used = new Set(next.tracks.flatMap((t) => t.regions.map((r) => r.clipId)));
    for (const id of Object.keys(next.clips)) if (!used.has(id)) delete next.clips[id];
  }
  if (next.assets) {
    const used = new Set(next.tracks.flatMap((t) => t.regions.map((r) => r.assetId)));
    for (const id of Object.keys(next.assets)) if (!used.has(id)) delete next.assets[id];
  }
  if (equalValue(next, doc)) return doc;
  next.updatedAt = Math.max(now, doc.updatedAt);
  const result = validateBeat(next);
  if (!result.ok) {
    if (result.reason) throw new BeatRefusal(result.reason);
    throw new Error('invalid');
  }
  return next;
}
function hits(doc, pad) { return doc.patterns[doc.currentPattern].rows[pad] || []; }
function put(doc, pad, step, velocity) {
  doc.patterns[doc.currentPattern].rows[pad] = [...hits(doc, pad).filter(([s]) => s !== step), [step, velocity]].sort((a, b) => a[0] - b[0]);
}
export const toggleStep = (doc, pad, step, now = Date.now()) => edit(doc, now, (d) => {
  const row = hits(d, pad);
  if (row.some(([s]) => s === step)) d.patterns[d.currentPattern].rows[pad] = row.filter(([s]) => s !== step);
  else put(d, pad, step, 100);
});
export const cycleVelocity = (doc, pad, step, dir = 1, now = Date.now()) => edit(doc, now, (d) => {
  const hit = hits(d, pad).find(([s]) => s === step);
  if (hit) put(d, pad, step, BEAT_LIMITS.velocities[(BEAT_LIMITS.velocities.indexOf(hit[1]) + (dir < 0 ? 2 : 1)) % 3]);
});
export const addHitAtStep = (doc, pad, step, now = Date.now()) => hits(doc, pad).some(([s]) => s === step)
  ? doc : edit(doc, now, (d) => put(d, pad, step, 100));
export const setTempo = (doc, bpm, now = Date.now()) => edit(doc, now, (d) => {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new BeatRefusal('Enter a tempo from 40 to 240 BPM.');
  d.tempo.bpm = bpm;
  for (const asset of Object.values(d.assets || {})) if (asset.source === 'sound') asset.durationSec = soundDuration(asset.ref, bpm);
  for (const track of d.tracks) for (const region of track.regions) if (region.assetId) clampFades(region, bpm);
});
export const setSwing = (doc, value, now = Date.now()) => edit(doc, now, (d) => { d.swing = value; });
export const setSteps = (doc, steps, now = Date.now()) => edit(doc, now, (d) => {
  d.steps = steps;
  for (const track of d.tracks) for (const region of track.regions) if (region.pattern) region.offset %= steps * 240;
});
export const selectPattern = (doc, slot, now = Date.now()) => slot === doc.currentPattern
  ? doc : edit(doc, now, (d) => { d.currentPattern = slot; });
export const copyPattern = (doc, from, to, now = Date.now()) => edit(doc, now, (d) => { d.patterns[to] = structuredClone(d.patterns[from]); });
export const clearPattern = (doc, now = Date.now()) => edit(doc, now, (d) => { d.patterns[d.currentPattern] = { rows: {} }; });
export const rename = (doc, title, now = Date.now()) => edit(doc, now, (d) => { d.title = title; });
export const setMetronome = (doc, enabled, now = Date.now()) => edit(doc, now, (d) => { d.metronome = enabled; });
export const restorePattern = (doc, slot, pattern, now = Date.now()) => edit(doc, now, (d) => { d.patterns[slot] = structuredClone(pattern); });

export class BeatRefusal extends Error {}
export function tryOp(doc, operation) {
  try { return { doc: operation(doc) }; }
  catch (error) {
    if (error instanceof BeatRefusal) return { doc, refused: error.message };
    throw error;
  }
}
export function trackById(doc, id) {
  const track = doc.tracks.find((t) => t.id === id);
  if (!track) throw new BeatRefusal('That track no longer exists.');
  return track;
}
export function regionById(doc, id) {
  for (const track of doc.tracks) {
    const region = track.regions.find((r) => r.id === id);
    if (region) return { track, region };
  }
  throw new BeatRefusal('That region no longer exists.');
}
export function nextId(doc, prefix) {
  const ids = new Set([...Object.keys(doc.assets || {}), ...Object.keys(doc.clips || {}), ...doc.tracks.flatMap((t) => [t.id, ...t.regions.map((r) => r.id)])]);
  let n = 1;
  while (ids.has(prefix + n.toString(36))) n++;
  return prefix + n.toString(36);
}
const mod = (n, length) => ((n % length) + length) % length;
function fragment(doc, region, start, length) {
  return region.clipId ? { ...region, start, length, phaseTicks: mod(region.phaseTicks + start - region.start, doc.clips[region.clipId].lengthTicks) } : region.assetId ? audioFragment(region, start, length, doc.assets[region.assetId], doc.tempo.bpm)
    : { ...region, start, length, offset: mod(region.offset + start - region.start, doc.steps * 240) };
}
// The edited region wins. Preserve the phase of every surviving fragment.
export function place(doc, track, edited) {
  if ((edited.clipId ? 'midi' : edited.assetId ? 'audio' : 'drums') !== (track.kind || 'drums')) throw new BeatRefusal('Regions need tracks of the same kind (drums, audio or MIDI).');
  const end = edited.start + edited.length;
  const survivors = [];
  if (!track.regions.some((r) => r.id === edited.id)) track.regions = [...track.regions, edited];
  for (const other of track.regions) {
    if (other.id === edited.id) continue;
    const otherEnd = other.start + other.length;
    if (otherEnd <= edited.start || other.start >= end) { survivors.push(other); continue; }
    if (other.start < edited.start) survivors.push(fragment(doc, other, other.start, edited.start - other.start));
    if (otherEnd > end) {
      const id = other.start < edited.start ? nextId(doc, 'r') : other.id;
      const right = { ...fragment(doc, other, end, otherEnd - end), id };
      survivors.push(right);
      // Reserve generated ids while processing additional fragments.
      if (id !== other.id) track.regions = [...track.regions, right];
    }
  }
  track.regions = [...survivors, edited].sort((a, b) => a.start - b.start);
}
export const addTrack = (doc, kit, now = Date.now()) => edit(doc, now, (d) => {
  d.tracks.push({ id: nextId(d, 't'), name: `Drums ${d.tracks.length + 1}`, ...(d.version >= 3 ? { kind: 'drums' } : {}), kit,
    mute: false, solo: false, gain: 1, pan: 0, regions: [] });
});
export const removeTrack = (doc, id, now = Date.now()) => edit(doc, now, (d) => {
  trackById(d, id);
  if (d.tracks.length === 1) throw new BeatRefusal('Keep at least one track.');
  d.tracks = d.tracks.filter((t) => t.id !== id);
});
const trackField = (field) => (doc, id, value, now = Date.now()) => edit(doc, now, (d) => { trackById(d, id)[field] = value; });
export const renameTrack = (doc, id, name, now = Date.now()) => edit(doc, now, (d) => {
  const track = trackById(d, id);
  if (typeof name !== 'string' || !name.trim()) throw new BeatRefusal('Give the track a name.');
  track.name = name.trim();
});
export const setTrackKit = trackField('kit');
export const setTrackMute = trackField('mute');
export const setTrackSolo = trackField('solo');
export const setTrackGain = trackField('gain');
export const setTrackPan = trackField('pan');
export const addRegion = (doc, trackId, start, pattern, now = Date.now()) => edit(doc, now, (d) => {
  place(d, trackById(d, trackId), { id: nextId(d, 'r'), start, length: d.steps * 240, offset: 0, pattern });
});
export const moveRegion = (doc, id, start, trackId, now = Date.now()) => edit(doc, now, (d) => {
  const { track, region } = regionById(d, id);
  track.regions = track.regions.filter((r) => r.id !== id);
  place(d, trackById(d, trackId), { ...region, start });
});
export const copyRegion = (doc, id, start, trackId, now = Date.now()) => edit(doc, now, (d) => {
  const { region } = regionById(d, id);
  place(d, trackById(d, trackId), { ...region, id: nextId(d, 'r'), start });
});
export const resizeRegion = (doc, id, length, now = Date.now()) => edit(doc, now, (d) => {
  const { track, region } = regionById(d, id);
  if (length < 240) throw new BeatRefusal('A region must be at least one step long.');
  const resized = length < region.length ? fragment(d, region, region.start, length) : { ...region, length };
  if (region.assetId && length > region.length) clampFades(resized, d.tempo.bpm);
  place(d, track, resized);
});
export const trimRegionStart = (doc, id, start, now = Date.now()) => edit(doc, now, (d) => {
  const { track, region } = regionById(d, id);
  const length = region.start + region.length - start;
  if (start < 0 || length < 240) throw new BeatRefusal('Keep the start before the end and inside the song.');
  place(d, track, fragment(d, region, start, length));
});
export const splitRegion = (doc, id, atTick, now = Date.now()) => edit(doc, now, (d) => {
  const { track, region } = regionById(d, id);
  if (atTick <= region.start || atTick >= region.start + region.length) throw new BeatRefusal('Place the playhead inside the region to split it.');
  const right = { ...fragment(d, region, atTick, region.start + region.length - atTick), id: nextId(d, 'r') };
  Object.assign(region, fragment(d, region, region.start, atTick - region.start));
  track.regions.push(right);
  track.regions.sort((a, b) => a.start - b.start);
});
export const duplicateRegion = (doc, id, now = Date.now()) => {
  const { track, region } = regionById(doc, id);
  return copyRegion(doc, id, region.start + region.length, track.id, now);
};
export const deleteRegion = (doc, id, now = Date.now()) => edit(doc, now, (d) => {
  const { track } = regionById(d, id);
  track.regions = track.regions.filter((r) => r.id !== id);
});
export const setRegionPattern = (doc, id, slot, now = Date.now()) => edit(doc, now, (d) => { regionById(d, id).region.pattern = slot; });
export const setCycle = (doc, cycle, now = Date.now()) => edit(doc, now, (d) => { d.cycle = { ...cycle }; });
export const setView = (doc, view, now = Date.now()) => edit(doc, now, (d) => { d.view = view; });
export const addHitToPattern = (doc, pattern, pad, step, now = Date.now()) => {
  if (doc.patterns[pattern]?.rows[pad]?.some(([s]) => s === step)) return doc;
  return edit(doc, now, (d) => {
    const rows = d.patterns[pattern].rows;
    rows[pad] = [...(rows[pad] || []), [step, 100]].sort((a, b) => a[0] - b[0]);
  });
};

export const addAudioTrack = (doc, now = Date.now()) => edit(doc, now, (d) => {
  d.tracks.push({ id: nextId(d, 't'), name: `Audio ${d.tracks.filter((t) => t.kind === 'audio').length + 1}`, kind: 'audio', mute: false, solo: false, gain: 1, pan: 0, regions: [] });
});
export const addAudioRegion = (doc, asset, trackId, start, now = Date.now()) => edit(doc, now, (d) => {
  let track = trackId && trackById(d, trackId);
  if (track && track.kind !== 'audio') throw new BeatRefusal('Choose an audio track for this sound.');
  if (!track) {
    track = { id: nextId(d, 't'), name: `Audio ${d.tracks.filter((t) => t.kind === 'audio').length + 1}`, kind: 'audio', mute: false, solo: false, gain: 1, pan: 0, regions: [] };
    d.tracks.push(track);
  }
  const existing = Object.entries(d.assets).find(([, a]) => JSON.stringify(a) === JSON.stringify(asset));
  const assetId = existing?.[0] || nextId(d, 'a');
  d.assets[assetId] = structuredClone(asset);
  const length = asset.source === 'sound' ? soundTicks(asset.ref) : Math.max(240, Math.round(asset.durationSec / tickSeconds(240, d.tempo.bpm)) * 240);
  place(d, track, { id: nextId(d, 'r'), start, length, assetId,
    ...(asset.source === 'sound' ? { phaseTicks: 0 } : { phaseSec: 0 }), gainDb: 0, fadeIn: null, fadeOut: null, reverse: false });
});
export const setAudioRegion = (doc, id, patch, now = Date.now()) => edit(doc, now, (d) => {
  const { region } = regionById(d, id);
  if (!region.assetId || Object.keys(patch).some((k) => !['gainDb', 'fadeIn', 'fadeOut', 'reverse'].includes(k))) throw new BeatRefusal('Choose an audio region.');
  Object.assign(region, patch);
  if (Object.hasOwn(patch, 'fadeIn') || Object.hasOwn(patch, 'fadeOut')) clampFades(region, d.tempo.bpm);
});

export function restoreVersion(doc, versionDoc, now = Date.now()) {
  const next = { ...structuredClone(versionDoc), id: doc.id, createdAt: doc.createdAt, updatedAt: Math.max(now, doc.updatedAt, doc.createdAt) };
  if (!validateBeat(next).ok) throw new Error('invalid');
  return next;
}
