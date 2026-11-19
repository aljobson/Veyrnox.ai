import { markersError } from './beatMarkerRules.mjs';
import { BEAT_WRITE_VERSION } from './beatCompatibility.mjs';
import { takeGroupsError } from './beatTakeRules.mjs';
import { masterError, trackMixError } from './beatMixRules.mjs';
import { clipsError, validInstrument, validMidiRegion } from './beatMidiRules.mjs';
import { validAsset, validAudioRegion } from './beatAudioRules.mjs';
import { DRUM_PADS, PRESETS } from '../../../../../lib/musicInstruments.js';

export const BEAT_LIMITS = Object.freeze({ bpm: [40, 240], swing: [0, 0.6], steps: [16, 32], patterns: ['A', 'B', 'C', 'D'], tracks: 16, regions: 400, songTicks: 512 * 3840, seconds: 600, projects: 50, title: 80, velocities: [60, 100, 127] });
export const validBeatId = (id) => typeof id === 'string' && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => object(v) && Object.keys(v).every((k) => allowed.includes(k));
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const fields = ['kind', 'version', 'id', 'title', 'createdAt', 'updatedAt', 'tempo', 'signature', 'swing', 'metronome', 'kit', 'steps', 'currentPattern', 'patterns'];
export function validateBeatV1(doc) {
  const invalid = { ok: false, error: 'invalid' };
  if (!keys(doc, fields) || fields.some((k) => !Object.hasOwn(doc, k))) return invalid;
  if (doc.kind !== 'veyrnox.music.beat' || doc.version !== 1 || !validBeatId(doc.id)) return invalid;
  if (typeof doc.title !== 'string' || !doc.title.trim() || doc.title.length > BEAT_LIMITS.title) return invalid;
  if (!Number.isSafeInteger(doc.createdAt) || doc.createdAt < 0 || !Number.isSafeInteger(doc.updatedAt) || doc.updatedAt < doc.createdAt) return invalid;
  if (!keys(doc.tempo, ['bpm']) || !finite(doc.tempo.bpm, ...BEAT_LIMITS.bpm)) return invalid;
  if (!Array.isArray(doc.signature) || doc.signature.length !== 2 || doc.signature.some((n) => n !== 4)) return invalid;
  if (!finite(doc.swing, ...BEAT_LIMITS.swing) || typeof doc.metronome !== 'boolean') return invalid;
  if (!PRESETS.drums.some((kit) => kit.id === doc.kit) || !BEAT_LIMITS.steps.includes(doc.steps) || !BEAT_LIMITS.patterns.includes(doc.currentPattern)) return invalid;
  if (!keys(doc.patterns, BEAT_LIMITS.patterns)) return invalid;
  for (const slot of BEAT_LIMITS.patterns) {
    const pattern = doc.patterns[slot];
    if (!keys(pattern, ['rows']) || !keys(pattern.rows, DRUM_PADS.map((pad) => pad.id))) return invalid;
    for (const hits of Object.values(pattern.rows)) {
      if (!Array.isArray(hits) || hits.length > 32) return invalid;
      let previous = -1;
      for (const hit of hits) {
        if (!Array.isArray(hit) || hit.length !== 2 || !Number.isInteger(hit[0]) || hit[0] <= previous || hit[0] >= 32 || !BEAT_LIMITS.velocities.includes(hit[1])) return invalid;
        previous = hit[0];
      }
    }
  }
  return { ok: true, doc };
}
export function createBeat({ id, title = 'Untitled beat 1', now = Date.now() }) {
  const patterns = Object.fromEntries(BEAT_LIMITS.patterns.map((slot) => [slot, { rows: Object.fromEntries(DRUM_PADS.map(({ id: pad }) => [pad, []])) }]));
  patterns.A.rows.kick = [[0, 100], [8, 100]];
  patterns.A.rows.snare = [[4, 100], [12, 100]];
  patterns.A.rows.hat = Array.from({ length: 8 }, (_, i) => [i * 2, 100]);
  const doc = { kind: 'veyrnox.music.beat', version: BEAT_WRITE_VERSION, assets: {}, clips: {}, id, title, createdAt: now, updatedAt: now,
    tempo: { bpm: 92 }, signature: [4, 4], swing: 0, metronome: false, steps: 16, currentPattern: 'A', patterns,
    view: 'song', tracks: [{ id: 't1', kind: 'drums', name: 'Drums', kit: '808', mute: false, solo: false, gain: 1, pan: 0,
      regions: [{ id: 'r1', start: 0, length: 4 * 3840, offset: 0, pattern: 'A' }] }],
    cycle: { on: false, start: 0, end: 4 * 3840 } };
  if (!validateBeat(doc).ok) throw new Error('invalid');
  return doc;
}

export const songEnd = (doc) => Math.max(0, ...doc.tracks.flatMap((t) => t.regions.map((r) => r.start + r.length)));
const ticks = (value) => Number.isSafeInteger(value) && value >= 0 && value % 240 === 0;
const exact = (value, names) => keys(value, names) && names.every((name) => Object.hasOwn(value, name));
export function arrangementError(doc) {
  if (!Array.isArray(doc.tracks) || !doc.tracks.length) return 'A song needs at least one track.';
  if (doc.tracks.length > BEAT_LIMITS.tracks) return 'A song can have at most 16 tracks.';
  if (doc.version >= 3 && (!object(doc.assets) || Object.keys(doc.assets).length > 64 ||
    Object.entries(doc.assets).some(([id, a]) => !/^a[0-9a-z]{1,12}$/.test(id) || !validAsset(a, doc.tempo.bpm)))) return 'Invalid sound assets (maximum 64).';
  if (doc.version === 4) { const reason = clipsError(doc.clips); if (reason) return reason; }
  const ids = new Set(), regionIds = new Set();
  for (const track of doc.tracks) {
    if (!object(track)) return 'Invalid track.';
    const midi = doc.version === 4 && track.kind === 'midi';
    const audio = doc.version >= 3 && track.kind === 'audio';
    const trackFields = ['id', 'name', 'mute', 'solo', 'gain', 'pan', 'regions', ...(midi ? ['instrument'] : audio ? [] : ['kit']), ...(doc.version >= 3 ? ['kind'] : [])];
    if (!(keys(track, [...trackFields, ...(doc.version === 4 ? ['fx', 'sends', 'automation', 'takeGroups'] : [])]) && trackFields.every(k => Object.hasOwn(track, k))) || (doc.version >= 3 && !(doc.version === 4 ? ['drums', 'audio', 'midi'] : ['drums', 'audio']).includes(track.kind)) ||
      typeof track.id !== 'string' || !/^t[0-9a-z]{1,12}$/.test(track.id) || ids.has(track.id) ||
      typeof track.name !== 'string' || !track.name.trim() || track.name.length > 40 ||
      (midi && !validInstrument(track.instrument)) || (!audio && !midi && !PRESETS.drums.some((kit) => kit.id === track.kit)) || typeof track.mute !== 'boolean' ||
      typeof track.solo !== 'boolean' || !finite(track.gain, 0, 1) || !finite(track.pan, -1, 1) ||
      !Array.isArray(track.regions)) return 'Invalid track.';
    if (doc.version === 4) { const reason = trackMixError(track); if (reason) return reason; }
    { const reason = takeGroupsError(track, doc); if (reason) return reason; }
    ids.add(track.id);
    let end = 0;
    for (const region of track.regions) {
      if (!object(region)) return 'Invalid region.';
      if ((midi ? !validMidiRegion(region, doc.clips[region.clipId]) : audio ? !validAudioRegion(region, doc.assets[region.assetId]) :
        (!exact(region, ['id', 'start', 'length', 'offset', 'pattern']) || !ticks(region.offset) || region.offset >= doc.steps * 240 || !BEAT_LIMITS.patterns.includes(region.pattern))) ||
        typeof region.id !== 'string' || !region.id.length || regionIds.has(region.id) ||
        !ticks(region.start) || !ticks(region.length) || region.length < 240) return 'Invalid region id, pattern or ticks.';
      if (region.start < end) return 'Regions on a track cannot overlap or be out of order.';
      end = region.start + region.length;
      regionIds.add(region.id);
    }
  }
  if (regionIds.size > BEAT_LIMITS.regions) return 'A song can have at most 400 regions.';
  if (songEnd(doc) > BEAT_LIMITS.songTicks) return 'A song can be at most 512 bars long.';
  if (songEnd(doc) / 960 * 60 / doc.tempo.bpm > BEAT_LIMITS.seconds) return 'A song can be at most 600 seconds long at this tempo.';
  const cycle = doc.cycle;
  if (!exact(cycle, ['on', 'start', 'end']) || typeof cycle.on !== 'boolean' ||
    !ticks(cycle.start) || !ticks(cycle.end) || cycle.start >= cycle.end) return 'The cycle needs a start before its end, on the step grid.';
  if (cycle.end > BEAT_LIMITS.songTicks) return 'The cycle must end within 512 bars.';
  if ((cycle.end - cycle.start) / 960 * 60 / doc.tempo.bpm > BEAT_LIMITS.seconds) return 'The cycle can be at most 600 seconds long at this tempo.';
  return null;
}
export function validateBeat(doc) {
  if (doc?.version === 5) {
    const { markers, ...base } = doc;
    const reason = markersError(markers);
    if (reason) return { ok: false, error: 'invalid', reason };
    const result = validateBeat({ ...base, version: 4 });
    return result.ok ? { ok: true, doc } : result;
  }
  if (doc?.version === 1) return validateBeatV1(doc);
  const invalid = { ok: false, error: 'invalid' };
  const v2Fields = [...fields.filter((field) => field !== 'kit'), 'view', 'tracks', 'cycle'];
  if (!exact(doc, doc?.version === 4 ? [...v2Fields, 'assets', 'clips', ...(Object.hasOwn(doc, 'master') ? ['master'] : [])] : doc?.version === 3 ? [...v2Fields, 'assets'] : v2Fields) || ![2, 3, 4].includes(doc.version) || !['song', 'pattern'].includes(doc.view)) return invalid;
  // Reuse the frozen v1 common-field validation without weakening legacy reads.
  const { tracks, cycle, view, assets, clips, master, ...common } = doc;
  if (!validateBeatV1({ ...common, version: 1, kit: '808' }).ok) return invalid;
  if (Object.hasOwn(doc, 'master') && masterError(master)) return { ...invalid, reason: masterError(master) };
  const reason = arrangementError(doc);
  return reason ? { ...invalid, reason } : { ok: true, doc };
}
export function migrateBeat(doc) {
  if (!validateBeat(doc).ok) throw new Error('invalid');
  if (doc.version === 4 || doc.version === 5) return doc;
  if (doc.version === 3) return { ...structuredClone(doc), version: BEAT_WRITE_VERSION, clips: {} };
  if (doc.version === 2) return { ...structuredClone(doc), version: BEAT_WRITE_VERSION, assets: {}, clips: {}, tracks: doc.tracks.map((t) => ({ ...structuredClone(t), kind: 'drums' })) };
  const { kit, ...common } = structuredClone(doc);
  const length = doc.steps * 240;
  return { ...common, version: BEAT_WRITE_VERSION, assets: {}, clips: {}, view: 'pattern',
    tracks: [{ id: 't1', kind: 'drums', name: 'Drums', kit, mute: false, solo: false, gain: 1, pan: 0,
      regions: [{ id: 'r1', start: 0, length, offset: 0, pattern: doc.currentPattern }] }],
    cycle: { on: false, start: 0, end: length } };
}

export function upgradeBeatToV5(doc) {
  const migrated = migrateBeat(doc);
  return migrated.version === 5 ? migrated : { ...structuredClone(migrated), version: 5 };
}
