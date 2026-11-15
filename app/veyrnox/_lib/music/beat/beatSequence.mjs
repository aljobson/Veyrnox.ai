import { BEAT_LIMITS, songEnd, validateBeat } from './beatDocument.mjs';
import { stepSeconds } from './beatTime.mjs';

export class BeatExportError extends RangeError {}
export function exportRange(doc) {
  if (!validateBeat(doc).ok || doc.version !== 2) throw new BeatExportError('Invalid song or cycle range.');
  return doc.cycle.on ? { startStep: doc.cycle.start / 240, endStep: doc.cycle.end / 240 }
    : { startStep: 0, endStep: Math.max(songEnd(doc) / 240, doc.steps) };
}
export function exportSize(doc, sampleRate = 44100) {
  const range = exportRange(doc);
  const seconds = (range.endStep - range.startStep) * stepSeconds(doc.tempo.bpm);
  const frames = Math.ceil((seconds + 1.5) * sampleRate);
  if (seconds > BEAT_LIMITS.seconds || 2 * frames > 2 * 44100 * (600 + 1.5)) {
    throw new BeatExportError('Song export is limited to 600 seconds.');
  }
  return { ...range, seconds, frames };
}
// null means Play must stay stopped; an enabled cycle may intentionally be silent.
export function playbackStart(doc, locator = 0) {
  if (doc.view === 'pattern') return 0;
  if (doc.cycle.on) {
    return (locator >= doc.cycle.start && locator < doc.cycle.end ? locator : doc.cycle.start) / 240;
  }
  const end = songEnd(doc);
  if (end === 0) return null;
  return locator >= end ? 0 : locator / 240;
}
export function sequenceFor(doc, locator = 0, editTrackId) {
  if (doc.view === 'pattern') return { doc, editTrackId, startStep: 0, endStep: doc.steps, loop: { start: 0, end: doc.steps } };
  const endStep = songEnd(doc) / 240;
  if (!doc.cycle.on) return { doc, editTrackId, startStep: playbackStart(doc, locator) ?? 0, endStep, loop: null };
  const loop = { start: doc.cycle.start / 240, end: doc.cycle.end / 240 };
  return { doc, editTrackId, startStep: playbackStart(doc, locator),
    endStep: loop.end, loop };
}
