import { mixTailSeconds } from './beatMixRules.mjs';
import { patternTrack } from './beatEvents.mjs';
import { BEAT_LIMITS, songEnd, validateBeat } from './beatDocument.mjs';
import { stepSeconds } from './beatTime.mjs';

export class BeatExportError extends RangeError {}
export function exportRange(doc, range) {
  if (!validateBeat(doc).ok || ![2, 3, 4, 5].includes(doc.version)) throw Object.assign(new BeatExportError('Invalid song or cycle range.'), { displayCode: 'invalid-range' });
  if (range && !['song', 'cycle'].includes(range)) throw Object.assign(new BeatExportError('Invalid export range.'), { displayCode: 'invalid-export-range' });
  if (range === 'cycle' && !doc.cycle.on) throw Object.assign(new BeatExportError('Turn Cycle on to export a cycle range.'), { displayCode: 'cycle-off' });
  return (range === 'cycle' || (!range && doc.cycle.on)) ? { startStep: doc.cycle.start / 240, endStep: doc.cycle.end / 240 }
    : { startStep: 0, endStep: Math.max(songEnd(doc) / 240, doc.steps) };
}
export function exportSize(doc, sampleRate = 44100, selectedRange) {
  const range = exportRange(doc, selectedRange);
  const seconds = (range.endStep - range.startStep) * stepSeconds(doc.tempo.bpm);
  const frames = Math.ceil((seconds + mixTailSeconds(doc)) * sampleRate);
  if (seconds > BEAT_LIMITS.seconds || frames > Math.ceil((600 + mixTailSeconds(doc)) * sampleRate)) {
    throw Object.assign(new BeatExportError('Song export is limited to 600 seconds.'), { displayCode: 'export-limit' });
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
export function sequenceFor(doc, locator = 0, editTrackId, regionId) {
  if (doc.view === 'pattern') {
    const track = patternTrack(doc, editTrackId);
    if (track?.kind === 'midi') {
      const region = track.regions.find((r) => r.id === regionId) || track.regions[0];
      const length = region ? doc.clips[region.clipId].lengthTicks : 3840;
      const preview = { ...doc, view: 'song', tracks: [{ ...track, regions: region ? [{ ...region, start: 0, length, phaseTicks: 0 }] : [] }] };
      return { doc: preview, editTrackId: track.id, startStep: 0, endStep: length / 240, loop: { start: 0, end: length / 240 } };
    }
  }
  if (doc.view === 'pattern') return { doc, editTrackId: patternTrack(doc, editTrackId)?.id, startStep: 0, endStep: doc.steps, loop: { start: 0, end: doc.steps } };
  const endStep = songEnd(doc) / 240;
  if (!doc.cycle.on) return { doc, editTrackId, startStep: playbackStart(doc, locator) ?? 0, endStep, loop: null };
  const loop = { start: doc.cycle.start / 240, end: doc.cycle.end / 240 };
  return { doc, editTrackId, startStep: playbackStart(doc, locator),
    endStep: loop.end, loop };
}
