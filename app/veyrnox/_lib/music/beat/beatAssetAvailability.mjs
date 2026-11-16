import { usedAssets } from './beatAudioRules.mjs';
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

// Create one guard per user action, never reuse it across downloads or saves.
export function exportAvailabilityGuard(doc, options, now = Date.now) {
  let confirmedAt = null, failure;
  return async () => {
    if (failure) throw failure;
    try {
      assertNoHeldAssets(doc, options.state);
      if (confirmedAt === null || now() - confirmedAt > 60_000) {
        await confirmAssetAvailability(doc, options);
        confirmedAt = now();
      }
    } catch (e) { failure = e; throw e; }
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
