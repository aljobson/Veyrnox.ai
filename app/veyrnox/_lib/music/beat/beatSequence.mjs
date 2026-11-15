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
export function sequenceFor(doc, locator = 0, editTrackId) {
  if (doc.view === 'pattern') return { doc, editTrackId, startStep: 0, endStep: doc.steps, loop: { start: 0, end: doc.steps } };
  const endStep = songEnd(doc) / 240;
  if (!doc.cycle.on) return { doc, editTrackId, startStep: Math.min(locator / 240, endStep), endStep, loop: null };
  const loop = { start: doc.cycle.start / 240, end: doc.cycle.end / 240 };
  const position = locator / 240;
  return { doc, editTrackId, startStep: position >= loop.start && position < loop.end ? position : loop.start,
    endStep: loop.end, loop };
}
