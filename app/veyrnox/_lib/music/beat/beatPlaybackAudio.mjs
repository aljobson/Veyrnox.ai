import { tickSeconds } from './beatAudioSegments.mjs';
import { sequenceFor } from './beatSequence.mjs';

export const arrangementStructure = (doc) => JSON.stringify(doc.tracks.map((track) =>
  [track.id, track.kind, track.regions.map((region) =>
    [region.id, region.start, region.length, region.assetId, region.clipId, region.pattern, region.phaseTicks, region.phaseSec, region.fadeIn, region.fadeOut, region.tailSec])]));

export function playbackAssets(doc, locator) {
  if (doc.view !== 'song') return [];
  const sequence = sequenceFor(doc, locator);
  const from = (sequence.loop?.start ?? sequence.startStep) * 240, to = sequence.endStep * 240;
  const assets = new Map();
  for (const track of doc.tracks) {
    if (track.kind !== 'audio') continue;
    for (const region of track.regions) {
      if (region.start >= to || region.start + region.length + (region.tailSec || 0) * doc.tempo.bpm * 16 <= from) continue;
      assets.set(`${region.assetId}:${region.reverse}`, { asset: doc.assets[region.assetId], reverse: region.reverse });
    }
  }
  return [...assets.values()];
}

// Scheduler slices already end at a loop seam: clipping cannot wrap the offset.
export function lateAudioSegment(segment, when, now) {
  const elapsed = Math.max(0, now - when);
  if (elapsed >= segment.durationSec) return null;
  return { ...segment, songTimeSec: segment.songTimeSec + elapsed,
    offsetSec: segment.offsetSec + elapsed, regionTimeSec: segment.regionTimeSec + elapsed,
    durationSec: segment.durationSec - elapsed, isRegionStart: segment.isRegionStart && elapsed === 0 };
}

export function audioLoopLabel(region, asset, bpm) {
  const ratio = tickSeconds(region.length, bpm) / asset.durationSec;
  const full = Math.floor(ratio + 1e-9), partial = ratio - full > 1e-9;
  if (!full) return 'partial loop';
  return `${full} full ${full === 1 ? 'loop' : 'loops'}${partial ? ' and a partial loop' : ''}`;
}

export function drumLoopLabel(region, steps) {
  const full = Math.floor(region.length / (steps * 240)), partial = region.length % (steps * 240) !== 0;
  if (!full) return 'partial loop';
  const label = full === 1 ? 'looped once' : full === 2 ? 'looped twice' : `looped ${full} times`;
  return `${label}${partial ? ' and a partial loop' : ''}`;
}
