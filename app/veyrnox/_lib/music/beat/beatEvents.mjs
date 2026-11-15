export function patternEvents(doc) {
  return Object.entries(doc.patterns[doc.currentPattern].rows)
    .flatMap(([pad, hits]) => hits.filter(([step]) => step < doc.steps).map(([step, velocity]) => ({ step, pad, velocity: velocity / 127 })))
    .sort((a, b) => a.step - b.step || a.pad.localeCompare(b.pad));
}

export const editTrack = (doc, id) => doc.tracks.find((track) => track.id === id) || doc.tracks[0];
export const patternTrack = (doc, id) => doc.tracks.find((track) => track.id === id && track.kind !== 'audio')
  || doc.tracks.find((track) => track.kind !== 'audio');
export const effectiveTrackGain = (doc, id) => editTrack(doc, id).gain;
const modulo = (n, length) => ((n % length) + length) % length;
export function recordTarget(doc, globalStep, editTrackId) {
  const track = doc.view === 'pattern' ? patternTrack(doc, editTrackId) : editTrack(doc, editTrackId);
  if (!track || track.kind === 'audio') return null;
  if (doc.view === 'pattern') return { pattern: doc.currentPattern, step: modulo(globalStep, doc.steps) };
  const tick = globalStep * 240;
  const region = track.regions.find((r) => r.start <= tick && tick < r.start + r.length);
  return region ? { pattern: region.pattern, step: modulo((tick - region.start + region.offset) / 240, doc.steps) } : null;
}
export function eventsAtStep(doc, globalStep, { editTrackId } = {}) {
  const tracks = doc.view === 'pattern' ? [patternTrack(doc, editTrackId)].filter(Boolean) : doc.tracks;
  const solo = doc.tracks.some((track) => track.solo);
  return tracks.flatMap((track) => {
    if (track.kind === 'audio') return [];
    if (doc.view === 'song' && (track.mute || (solo && !track.solo))) return [];
    const target = recordTarget(doc, globalStep, track.id);
    if (!target) return [];
    return Object.entries(doc.patterns[target.pattern].rows).flatMap(([pad, hits]) => {
      const hit = hits.find(([step]) => step === target.step);
      return hit ? [{ trackId: track.id, pad, velocity: hit[1] / 127 }] : [];
    });
  });
}
