import { validateBeat, BEAT_LIMITS } from './beatDocument.mjs';
import { tickSeconds } from './beatAudioSegments.mjs';
export function placedAlready(doc, record, ordinal) {
  const ids = record.placementIds[ordinal];
  const track = doc.tracks.find(t => t.id === ids.track);
  return !!track?.regions.some(r => r.id === ids.region && r.assetId === ids.asset);
}
export function placeAiResults(doc, record, results) {
  const additions = results.filter(r => !placedAlready(doc, record, r.ordinal));
  if (!additions.length) return doc;
  if (doc.tracks.length + additions.length > BEAT_LIMITS.tracks) throw new Error('Remove a track before adding these parts.');
  const next = structuredClone(doc), p = record.placement;
  const sourceTrack = next.tracks.find(t => t.id === p.sourceTrackId);
  const anchor = next.tracks.findIndex(t => t.id === p.afterTrackId);
  const sourceGone = p.sourceTrackId && (!sourceTrack || !sourceTrack.regions.some(r => r.id === p.regionId));
  const start = sourceGone ? Math.max(0, ...next.tracks.flatMap(t => t.regions.map(r => r.start + r.length))) : p.start;
  const maxTicks = Math.min(BEAT_LIMITS.songTicks, Math.floor(BEAT_LIMITS.seconds * doc.tempo.bpm / 60 * 960 / 240) * 240);
  let audible = results.some(r => placedAlready(doc, record, r.ordinal));
  const tracks = additions.map(({ ordinal, asset, name }) => {
    const ids = record.placementIds[ordinal];
    if (next.tracks.some(t => t.id === ids.track || t.regions.some(r => r.id === ids.region)) || next.assets[ids.asset])
      throw new Error('This result conflicts with another edit. Keep it in Music and try again.');
    const phaseSec = p.phaseSec;
    if (phaseSec >= asset.durationSec) throw new Error('This result is shorter than the source offset.');
    let length = record.op === 'extend' ? Math.floor((asset.durationSec - phaseSec) * doc.tempo.bpm / 60 * 960 / 240) * 240 : p.length;
    length = Math.min(length, maxTicks - start);
    if (length < 240 || tickSeconds(start + length, doc.tempo.bpm) > 600) throw new Error('This part exceeds the song length limit.');
    next.assets[ids.asset] = asset;
    const mute = ['stems', 'targetStems'].includes(record.op) ? false : audible;
    audible = true;
    return { id: ids.track, kind: 'audio', name: name.slice(0, 40), mute, solo: false, gain: 1, pan: 0,
      regions: [{ id: ids.region, start, length, assetId: ids.asset, phaseSec, gainDb: 0, fadeIn: null, fadeOut: null, reverse: false }] };
  });
  next.tracks.splice(anchor >= 0 && !sourceGone ? anchor + 1 : next.tracks.length, 0, ...tracks);
  if (sourceTrack && tracks.length) sourceTrack.mute = true;
  next.updatedAt = Math.max(Date.now(), doc.updatedAt);
  const check = validateBeat(next); if (!check.ok) throw new Error('These parts exceed the project limits.');
  return next;
}
