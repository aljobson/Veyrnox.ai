export function markersError(markers) {
  if (markers === undefined) return null;
  if (!Array.isArray(markers) || markers.length > 99) return 'invalid_markers';
  const ids = new Set();
  for (const marker of markers) {
    if (!marker || Object.keys(marker).sort().join(',') !== 'id,name,tick' ||
      typeof marker.id !== 'string' || !marker.id.trim() || ids.has(marker.id) ||
      typeof marker.name !== 'string' || !marker.name.trim() || marker.name.length > 40 ||
      !Number.isSafeInteger(marker.tick) || marker.tick < 0 || marker.tick > 512 * 3840) return 'invalid_markers';
    ids.add(marker.id);
  }
  return null;
}
