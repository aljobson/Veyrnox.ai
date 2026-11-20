import { edit, BeatRefusal } from './beatOps.mjs';
function track(doc, id) {
  const found = doc.tracks.find(t => t.id === id);
  if (!found) throw new BeatRefusal('track_not_found', 'track_not_found');
  return found;
}
function ripple(doc, now, operation) {
  try { return edit(doc, now, operation); }
  catch (error) {
    if (error.code) throw error;
    throw new BeatRefusal(error.message, 'invalid_ripple');
  }
}
export function rippleDeleteRegion(doc, trackId, regionId, now = Date.now()) {
  return ripple(doc, now, d => {
    const t = track(d, trackId), region = t.regions.find(r => r.id === regionId);
    if (!region) throw new BeatRefusal('region_not_found', 'region_not_found');
    t.regions = t.regions.filter(r => r.id !== regionId).map(r =>
      r.start >= region.start + region.length ? { ...r, start: r.start - region.length } : r);
  });
}
export function rippleInsertGap(doc, trackId, atTick, lengthTicks, now = Date.now()) {
  if (!Number.isSafeInteger(atTick) || atTick < 0 || !Number.isSafeInteger(lengthTicks) || lengthTicks <= 0)
    throw new BeatRefusal('invalid_ticks', 'invalid_ticks');
  return ripple(doc, now, d => {
    const t = track(d, trackId);
    t.regions = t.regions.map(r => r.start >= atTick ? { ...r, start: r.start + lengthTicks } : r);
  });
}
