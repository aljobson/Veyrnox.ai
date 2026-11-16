import { usedAssets } from './beatAudioRules.mjs';
import { exportRange } from './beatSequence.mjs';
import { effectiveGain } from './beatEvents.mjs';
import { tickSeconds } from './beatAudioSegments.mjs';
export const HELD_EXPORT = "A part in this song is held for review, so it can't be exported. Remove it, or try again after review.";
export const UNCONFIRMED_EXPORT = "Couldn't confirm every part is still available. Try again.";
export const isHeldError = e => e?.status === 404 && (e.code === 'held' || e.body?.error === 'held');
export function assetSigningPath(asset) {
  if (asset.source === 'song') return `/jobs/${asset.ref.jobId}/asset`;
  if (asset.source === 'stem') return `/music/stem-requests/${asset.ref.requestId}/archive`;
  if (asset.source === 'target') return `/music/target-stem-requests/${asset.ref.requestId}/${asset.ref.kind}`;
  return null;
}
export function assertNoHeldAssets(doc, state) {
  if (usedAssets(doc).some(id => state(doc.assets[id], doc.tempo.bpm).status === 'held'))
    throw Object.assign(new Error(HELD_EXPORT), { code: 'asset_held' });
}
// The URL is deliberately discarded: cached audio is never release authority.
export async function confirmAssetAvailability(doc, { request, state, markHeld }) {
  assertNoHeldAssets(doc, state);
  const assets = new Map();
  for (const id of usedAssets(doc)) {
    const asset = doc.assets[id], path = assetSigningPath(asset);
    if (!path) continue;
    if (!assets.has(path)) assets.set(path, []);
    assets.get(path).push(asset);
  }
  const entries = [...assets];
  let cursor = 0, failure;
  async function worker() {
    while (!failure && cursor < entries.length) {
      const [path, aliases] = entries[cursor++];
      try {
        const result = await request(path);
        if (!result?.url) throw new Error('Missing signed URL');
      } catch (e) {
        if (isHeldError(e)) {
          // Mark every document alias, including metadata variants of this source.
          aliases.forEach(markHeld);
          failure = Object.assign(new Error(HELD_EXPORT), { code: 'asset_held' });
        } else failure ||= Object.assign(new Error(UNCONFIRMED_EXPORT), { code: 'asset_unconfirmed' });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  if (failure) throw failure;
  assertNoHeldAssets(doc, state);
}

// Restrict release authority to the audio actually used by this delivered file.
export function exportAssetDocument(doc, { range = 'song', soloTrackId, pattern = false } = {}) {
  if (pattern) return { ...doc, tracks: [] }; // Drum-pattern exports use no assets.
  const { startStep, endStep } = exportRange(doc, range);
  return { ...doc, tracks: doc.tracks.filter(t => effectiveGain(doc, t.id, 'song') > 0
    && (!soloTrackId || t.id === soloTrackId)).map(t => ({ ...t, regions: t.regions.filter(r => {
      if (!r.assetId) return false;
      const from = Math.max(0, tickSeconds(startStep * 240 - r.start, doc.tempo.bpm), r.fadeIn?.startSec ?? 0);
      const to = Math.min(tickSeconds(r.length, doc.tempo.bpm) - (r.fadeOut?.endBeforeEndSec ?? 0),
        tickSeconds(endStep * 240 - r.start, doc.tempo.bpm));
      return from < to;
    }) })) };
}

// One guard per export run: every delivery is fresh; a failure stops the run.
export function exportAvailabilityGuard(doc, options) {
  let failure;
  return async selection => {
    if (failure) throw failure;
    try { await confirmAssetAvailability(exportAssetDocument(doc, selection), options); }
    catch (e) { failure = e; throw e; }
  };
}

// Observe transitions, so an already-held silent placeholder does not prevent
// later playback of the rest of the song.
export function playbackHoldObserver({ current, state, playing, stop, announce }) {
  const held = () => new Set(current()?.tracks.flatMap(t => t.regions.filter(r => r.assetId && state(current().assets[r.assetId], current().tempo.bpm).status === 'held').map(r => r.assetId)) || []);
  let previous = held();
  return () => {
    const next = held(), changed = [...next].some(id => !previous.has(id)); previous = next;
    if (changed && playing()) { stop(); announce('Playback stopped: a part is held for review'); }
  };
}
