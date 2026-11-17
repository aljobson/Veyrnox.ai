const ticks = n => Number.isSafeInteger(n) && n >= 0 && n % 240 === 0;
export function takeGroupsError(track, doc) {
  if (!Object.hasOwn(track, 'takeGroups')) return null;
  if (doc.version !== 4 || track.kind !== 'audio' || !Array.isArray(track.takeGroups) || track.takeGroups.length > 16) return 'Invalid take groups (maximum 16 per audio track).';
  const ids = new Set();
  let end = 0;
  for (const g of [...track.takeGroups].sort((a, b) => a?.start - b?.start)) {
    if (!g || Object.keys(g).length !== 6 || !['id', 'start', 'length', 'lanes', 'comp', 'xfadeMs'].every(k => Object.hasOwn(g, k)) ||
      typeof g.id !== 'string' || !/^g[0-9a-z]{1,12}$/.test(g.id) || ids.has(g.id) || !ticks(g.start) || !ticks(g.length) || g.length < 240 || g.start < end ||
      g.start + g.length > Math.min(512 * 3840, 600 * doc.tempo.bpm * 16) || ![0, 5, 10, 20, 50].includes(g.xfadeMs) ||
      !Array.isArray(g.lanes) || g.lanes.length < 1 || g.lanes.length > 8 || new Set(g.lanes).size !== g.lanes.length ||
      g.lanes.some(id => typeof id !== 'string' || doc.assets?.[id]?.source !== 'take') ||
      !Array.isArray(g.comp) || !g.comp.length || g.comp.length > 400 || g.comp[0]?.[0] !== g.start) return 'Invalid take group.';
    let previous = -1;
    for (const pair of g.comp) {
      if (!Array.isArray(pair) || pair.length !== 2 || !ticks(pair[0]) || pair[0] < g.start || pair[0] <= previous || pair[0] >= g.start + g.length || !Number.isInteger(pair[1]) || pair[1] < 0 || pair[1] >= g.lanes.length) return 'Invalid take comp.';
      previous = pair[0];
    }
    ids.add(g.id); end = g.start + g.length;
  }
  return null;
}
