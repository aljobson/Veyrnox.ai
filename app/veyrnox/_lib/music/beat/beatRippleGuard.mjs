// Preview only region transformations: calling beatOps.edit here would already prune takes.
export function guardRipple(doc, { type, trackId, regionId, atTick, lengthTicks = 3840 }) {
  const track = doc.tracks.find(t => t.id === trackId);
  const refuse = reason => ({ ok: false, reason });
  if (!track) return refuse('track_not_found');
  let regions;
  if (type === 'delete') {
    const region = track.regions.find(r => r.id === regionId);
    if (!region) return refuse('region_not_found');
    regions = track.regions.filter(r => r.id !== regionId).map(r =>
      r.start >= region.start + region.length ? { ...r, start: r.start - region.length } : r);
  } else if (type === 'insert') {
    if (!Number.isSafeInteger(atTick) || atTick < 0 || !Number.isSafeInteger(lengthTicks) || lengthTicks <= 0)
      return refuse('invalid_ticks');
    if (track.regions.some(r => r.start < atTick && atTick < r.start + r.length)) return refuse('ripple_inside_region');
    if (!track.regions.some(r => r.start >= atTick)) return refuse('ripple_nothing_to_move');
    regions = track.regions.map(r => r.start >= atTick ? { ...r, start: r.start + lengthTicks } : r);
  } else return refuse('invalid_ripple');
  for (const owner of doc.tracks) for (const group of owner.takeGroups || []) {
    // Match beatOps.edit's temporal overlap and compare the complete region values,
    // including moves within a group. Empty groups can gain overlapping regions too.
    const inside = list => list.filter(r => r.start < group.start + group.length && r.start + r.length > group.start);
    const before = inside(owner.regions), after = inside(owner.id === trackId ? regions : owner.regions);
    if (before.length !== after.length || before.some((r, i) => r !== after[i])) return refuse('ripple_take_group');
  }
  return { ok: true };
}
