export function patternEvents(doc) {
  return Object.entries(doc.patterns[doc.currentPattern].rows)
    .flatMap(([pad, hits]) => hits.filter(([step]) => step < doc.steps).map(([step, velocity]) => ({ step, pad, velocity: velocity / 127 })))
    .sort((a, b) => a.step - b.step || a.pad.localeCompare(b.pad));
}

export const editTrack = (doc, id) => doc.tracks.find((track) => track.id === id) || doc.tracks[0];
export const effectiveTrackGain = (doc, id) => editTrack(doc, id).gain;
const modulo = (n, length) => ((n % length) + length) % length;
export function recordTarget(doc, globalStep, editTrackId) {
  if (doc.view === 'pattern') return { pattern: doc.currentPattern, step: modulo(globalStep, doc.steps) };
  const tick = globalStep * 240;
  const region = editTrack(doc, editTrackId).regions.find((r) => r.start <= tick && tick < r.start + r.length);
  return region ? { pattern: region.pattern, step: modulo((tick - region.start + region.offset) / 240, doc.steps) } : null;
}
export function eventsAtStep(doc, globalStep, { editTrackId } = {}) {
  const tracks = doc.view === 'pattern' ? [editTrack(doc, editTrackId)] : doc.tracks;
  const solo = doc.tracks.some((track) => track.solo);
  return tracks.flatMap((track) => {
    if (doc.view === 'song' && (track.mute || (solo && !track.solo))) return [];
    const target = recordTarget(doc, globalStep, track.id);
    if (!target) return [];
    return Object.entries(doc.patterns[target.pattern].rows).flatMap(([pad, hits]) => {
      const hit = hits.find(([step]) => step === target.step);
      return hit ? [{ trackId: track.id, pad, velocity: hit[1] / 127 }] : [];
    });
  });
}
