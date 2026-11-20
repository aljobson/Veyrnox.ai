import { edit, BeatRefusal } from './beatOps.mjs';
import { markersError } from './beatMarkerRules.mjs';
function requireV5(doc) {
  if (doc.version !== 5) throw new BeatRefusal('markers_require_v5', 'markers_require_v5');
}
function change(doc, mutate, now) {
  requireV5(doc);
  return edit(doc, now, d => {
    d.markers ||= [];
    mutate(d.markers);
    if (markersError(d.markers)) throw new BeatRefusal('invalid_markers', 'invalid_markers');
  });
}
function marker(markers, id) {
  const found = markers.find(m => m.id === id);
  if (!found) throw new BeatRefusal('marker_not_found', 'marker_not_found');
  return found;
}
export const addMarker = (doc, value, now = Date.now()) => change(doc, m => m.push({ ...value }), now);
export const moveMarker = (doc, id, tick, now = Date.now()) => change(doc, m => { marker(m, id).tick = tick; }, now);
export const renameMarker = (doc, id, name, now = Date.now()) => change(doc, m => { marker(m, id).name = name; }, now);
export const removeMarker = (doc, id, now = Date.now()) => change(doc, m => { m.splice(m.indexOf(marker(m, id)), 1); }, now);
export function nextMarker(doc, tick) {
  requireV5(doc);
  return [...(doc.markers || [])].sort((a, b) => a.tick - b.tick).find(m => m.tick > tick) || null;
}
export function prevMarker(doc, tick) {
  requireV5(doc);
  return [...(doc.markers || [])].sort((a, b) => b.tick - a.tick).find(m => m.tick < tick) || null;
}
