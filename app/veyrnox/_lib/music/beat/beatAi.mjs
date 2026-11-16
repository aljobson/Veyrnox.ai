import { MUSIC_KEY_SCALES } from '../../../../../lib/musicTempoControls.js';
import { tickSeconds, modulo } from './beatAudioSegments.mjs';
export { MUSIC_KEY_SCALES as BEAT_AI_KEYS };
export const AI_INSTRUMENTS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'strings', 'synthesizer', 'brass', 'woodwinds'];
export const AI_LABELS = { generate: 'Generate a part', stems: 'Split stems', targetStems: 'Target stem', extend: 'Extend', replace: 'Replace section' };
export const AI_TERMINAL = new Set(['succeeded', 'partial', 'failed', 'refunded', 'ready']);
export function trackCapacity(doc) {
  return doc.tracks.length > 14 ? `Generating adds two tracks. This song has ${doc.tracks.length} of 16 — remove ${doc.tracks.length - 14 === 1 ? 'one' : 'two'} first` : '';
}
export function generateBody(doc, prompt, key = '') {
  const seconds = tickSeconds(doc.cycle.end - doc.cycle.start, doc.tempo.bpm);
  if (!(seconds > 0) || seconds > 60) throw new Error('Make the cycle 60 seconds or shorter');
  if (doc.tempo.bpm > 220) throw new Error('Set the tempo to 220 BPM or less');
  if (!prompt.trim() || prompt.trim().length > 400) throw new Error('Describe a part in 1–400 characters');
  if (key && !MUSIC_KEY_SCALES.includes(key)) throw new Error('Choose a musical key');
  const bpm = Math.max(40, Math.min(220, Math.round(doc.tempo.bpm))), bars = (doc.cycle.end - doc.cycle.start) / 3840;
  return { mode: 'simple', model_id: 'ace-step-loop', prompt: `${prompt.trim()}. Instrumental part, ${bars} bars of 4/4 at ${bpm} BPM${key ? `, in ${key}` : ''}.`,
    title: `${doc.title.trim().slice(0, 75)} part`, duration_seconds: Math.max(10, Math.ceil(seconds)), bpm, key_scale: key || null, time_signature: '4' };
}
export function replaceRange(doc, region, asset) {
  if (region.reverse) throw new Error("Replace isn't available on reversed audio");
  const start = Math.max(doc.cycle.start, region.start), end = Math.min(doc.cycle.end, region.start + region.length);
  if (end <= start) throw new Error('Set the cycle over 1–30 s of this region');
  const from = modulo(region.phaseSec + tickSeconds(start - region.start, doc.tempo.bpm), asset.durationSec);
  const length = tickSeconds(end - start, doc.tempo.bpm);
  if (from + length > asset.durationSec + 1e-8) throw new Error('Set the cycle inside one pass of this sound');
  if (length < 1 || length > 30) throw new Error('Set the cycle over 1–30 s of this region');
  return { start_seconds: from, end_seconds: from + length };
}
export function actionEligibility(op, doc, region, asset, song, state) {
  if (state?.status === 'held') return 'This part is held for review';
  if (!song) return 'Checking this song…';
  if (asset.ref.versionId !== song.version_id || asset.ref.versionId !== song.current_version?.id)
    return "This isn't the song's current version. Make it current in Music to use AI on it.";
  if (op === 'extend' && asset.durationSec > 120) return 'Extend needs a song of 120 seconds or less';
  if (op === 'targetStems' && asset.durationSec > 120) return 'Target stem needs a song of 120 seconds or less';
  if (op === 'replace') {
    if (asset.durationSec > 60) return 'Replace needs a song of 60 seconds or less';
    if (region.reverse) return "Replace isn't available on reversed audio";
    if (tickSeconds(region.length, doc.tempo.bpm) > asset.durationSec - region.phaseSec + 1e-8)
      return "Replace works on a region that doesn't repeat its sound";
    try { replaceRange(doc, region, asset); } catch (e) { return e.message; }
  }
  return trackCapacity(doc);
}
export function aiPaths(op, songId) {
  if (op === 'generate') return { quote: '/music/generation-quotes', submit: '/music/generations' };
  const names = { stems: ['stem-quotes', 'stems'], targetStems: ['target-stem-quotes', 'target-stems'], extend: ['extend-quotes', 'extends'], replace: ['replace-quotes', 'replacements'] }[op];
  if (!names) throw new Error('Unknown AI operation');
  return { quote: `/music/songs/${songId}/${names[0]}`, submit: `/music/songs/${songId}/${names[1]}` };
}
export const aiPollPath = r => `/music/${r.op === 'stems' ? 'stem-requests' : r.op === 'targetStems' ? 'target-stem-requests' : 'generations'}/${r.requestId}`;
export function actionBody(op, { doc, region, asset, prompt, instrument, rights }) {
  if (!rights) throw new Error('Confirm permission to use this audio');
  const body = { version_id: asset.ref.versionId, rights_confirmed: true };
  if (op === 'targetStems') {
    if (!AI_INSTRUMENTS.includes(instrument)) throw new Error('Choose an instrument');
    body.instrument = instrument;
  }
  if (['extend', 'replace'].includes(op)) {
    if (!prompt.trim() || prompt.trim().length > 400) throw new Error('Describe the part in 1–400 characters');
    body.prompt = prompt.trim();
  }
  return op === 'replace' ? { ...body, ...replaceRange(doc, region, asset) } : body;
}
export function aiError(e, op) {
  if (e.status === 401) return 'Sign in again to continue. Your request is kept here.';
  if (e.status === 403) return 'This song belongs to another account';
  if (op === 'stems' && ['source_unavailable', 'format_unavailable', 'source_size_invalid'].includes(e.code)) return 'Stems need an MP3 song of 10 MB or less';
  if (e.code === 'rate_limited') return `Too many requests. Try again in ${e.retryAfter || 60} seconds.`;
  return ({ source_held: 'This part is held for review', plan_unavailable: 'AI parts need an active paid plan.',
    insufficient_balance: 'Not enough Credits — Buy Credits', prompt_blocked: 'Describe the part differently and try again.',
    prompt_not_allowed: 'Describe the part differently and try again.', prompt_invalid: 'Describe a part in 1–400 characters',
    range_invalid: 'Set the cycle over 1–30 s of this region', source_duration_invalid: 'This song is too long for this action',
    source_unavailable: 'This source is no longer available', network_error: 'Generate needs a connection',
    model_unavailable: "AI parts aren't available right now", quote_expired: 'This price expired. Get a new price.',
    quote_stale: 'This price changed. Get a new price.' })[e.code] || (e.code ? "AI parts aren't available right now" : e.message || 'Could not complete the request. Try again.');
}
