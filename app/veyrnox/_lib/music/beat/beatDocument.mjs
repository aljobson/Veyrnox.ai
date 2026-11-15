import { DRUM_PADS, PRESETS } from '../../../../../lib/musicInstruments.js';

export const BEAT_LIMITS = Object.freeze({ bpm: [40, 240], swing: [0, 0.6], steps: [16, 32], patterns: ['A', 'B', 'C', 'D'], projects: 50, title: 80, velocities: [60, 100, 127] });
export const validBeatId = (id) => typeof id === 'string' && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => object(v) && Object.keys(v).every((k) => allowed.includes(k));
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const fields = ['kind', 'version', 'id', 'title', 'createdAt', 'updatedAt', 'tempo', 'signature', 'swing', 'metronome', 'kit', 'steps', 'currentPattern', 'patterns'];
export function validateBeat(doc) {
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
  const doc = { kind: 'veyrnox.music.beat', version: 1, id, title, createdAt: now, updatedAt: now, tempo: { bpm: 92 }, signature: [4, 4], swing: 0, metronome: false, kit: '808', steps: 16, currentPattern: 'A', patterns };
  if (!validateBeat(doc).ok) throw new Error('invalid');
  return doc;
}
