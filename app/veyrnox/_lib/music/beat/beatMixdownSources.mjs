import { exportRange } from './beatSequence.mjs';
import { effectiveGain } from './beatEvents.mjs';
import { tickSeconds } from './beatAudioSegments.mjs';
export function mixdownSources(doc, { range = 'song', soloTrackId } = {}) {
  const { startStep, endStep } = exportRange(doc, range);
  const songs = new Map(); let hasTakes = false;
  for (const track of doc.tracks) {
    if (effectiveGain(doc, track.id, 'song') === 0 || (soloTrackId && track.id !== soloTrackId)) continue;
    for (const region of track.regions) {
      if (region.start >= endStep * 240 || region.start + region.length <= startStep * 240) continue;
      const asset = doc.assets?.[region.assetId];
      if (!asset) continue;
      // A clipped fade can leave the selected window entirely silent. Only
      // the interval where both fade envelopes are positive uses this source.
      const length = tickSeconds(region.length, doc.tempo.bpm);
      const from = Math.max(0, tickSeconds(startStep * 240 - region.start, doc.tempo.bpm), region.fadeIn?.startSec ?? 0);
      const to = Math.min(length, tickSeconds(endStep * 240 - region.start, doc.tempo.bpm), length - (region.fadeOut?.endBeforeEndSec ?? 0));
      if (from >= to) continue;
      if (asset?.source === 'take') hasTakes = true;
      if (['song', 'stem', 'target'].includes(asset?.source)) songs.set(asset.ref.versionId, { song_id: asset.ref.songId, version_id: asset.ref.versionId });
    }
  }
  if (songs.size > 16) throw new Error('This mix uses more than 16 song versions. Export a shorter cycle range or download the WAV instead.');
  return { songs: [...songs.values()].sort((a, b) => a.version_id.localeCompare(b.version_id)), hasTakes };
}
