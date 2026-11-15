import { tickSeconds, modulo } from './beatAudioSegments.mjs';
import { swingDelay } from './beatTime.mjs';
// Only onsets are admitted. Locator/cycle starts deliberately never re-trigger a
// note already in progress. Cuts shorten crossing notes; drum envelopes ignore release.
export function midiNoteOnsInWindow(doc, fromSec, toSec, { tempo = doc.tempo.bpm, endSec = Infinity, includeMuted = false } = {}) {
  const result = [], solo = doc.tracks.some((t) => t.solo), tickSec = tickSeconds(1, tempo);
  for (const track of doc.tracks) {
    if (track.kind !== 'midi' || (!includeMuted && (track.mute || (solo && !track.solo)))) continue;
    for (const region of track.regions) {
      const clip = doc.clips[region.clipId], end = region.start + region.length;
      const first = region.start - region.phaseTicks;
      // Include the preceding swing offset at a partition boundary.
      const low = Math.max(0, Math.floor((fromSec / tickSec - 120 - first) / clip.lengthTicks));
      const high = Math.ceil((Math.min(toSec / tickSec, end) - first) / clip.lengthTicks);
      for (let repeat = low; repeat <= high; repeat++) {
        const base = first + repeat * clip.lengthTicks;
        for (const [start, length, pitch, velocity] of clip.notes) {
          const tick = base + start;
          if (tick < region.start || tick >= end) continue;
          const delay = tick % 480 === 240 ? swingDelay(tick / 240, tempo, doc.swing) : 0;
          const songTimeSec = tick * tickSec + delay;
          if (songTimeSec < fromSec || songTimeSec >= toSec) continue;
          const durationSec = Math.min(length * tickSec, (Math.min(end, base + clip.lengthTicks) - tick) * tickSec - delay, endSec - songTimeSec);
          if (durationSec > 0) result.push({ trackId: track.id, pitch, velocity, songTimeSec, durationSec });
        }
      }
    }
  }
  return result.sort((a, b) => a.songTimeSec - b.songTimeSec || a.trackId.localeCompare(b.trackId) || a.pitch - b.pitch);
}
export function contextTimeToSongTick({ contextStart, startTick = 0, tempo, cycle = null }, t) {
  let tick = startTick + (t - contextStart) / tickSeconds(1, tempo);
  if (cycle && tick >= cycle.end) tick = cycle.start + modulo(tick - cycle.end, cycle.end - cycle.start);
  return Math.round(tick);
}
