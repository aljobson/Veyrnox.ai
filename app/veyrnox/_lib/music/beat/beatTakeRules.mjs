// Kept compact: this validator ships in the server bundle with the cloud route (Worker size budget).
const tick = n => Number.isSafeInteger(n) && n >= 0 && n % 240 === 0;
const KEYS = 'comp,id,lanes,length,start,xfadeMs';
function groupOk(g, doc, end, ids) {
  const stop = g?.start + g?.length, lanes = g?.lanes, comp = g?.comp;
  if (!g || Object.keys(g).sort().join() !== KEYS || typeof g.id != 'string' || !/^g[0-9a-z]{1,12}$/.test(g.id) || ids.has(g.id) || !tick(g.start) || !tick(g.length)
    || g.length < 240 || g.start < end || stop > Math.min(1966080, 9600 * doc.tempo.bpm) || ![0, 5, 10, 20, 50].includes(g.xfadeMs)
    || !Array.isArray(lanes) || !lanes.length || lanes.length > 8 || new Set(lanes).size < lanes.length
    || lanes.some(id => typeof id != 'string' || doc.assets?.[id]?.source != 'take')
    || !Array.isArray(comp) || !comp.length || comp.length > 400 || comp[0]?.[0] !== g.start) return false;
  return comp.every((p, i) => Array.isArray(p) && p.length == 2 && tick(p[0]) && p[0] < stop && (!i || p[0] > comp[i - 1][0])
    && Number.isInteger(p[1]) && p[1] >= 0 && p[1] < lanes.length);
}
/** Error text for an audio track's optional take groups, or null when valid or absent. */
export function takeGroupsError(track, doc) {
  if (!Object.hasOwn(track, 'takeGroups')) return null;
  const groups = track.takeGroups;
  if (![4, 5].includes(doc.version) || track.kind !== 'audio' || !Array.isArray(groups) || groups.length > 16) return 'Invalid take groups.';
  const ids = new Set();
  let end = 0;
  for (const g of [...groups].sort((a, b) => a?.start - b?.start)) {
    if (!groupOk(g, doc, end, ids)) return 'Invalid take group.';
    ids.add(g.id); end = g.start + g.length;
  }
  return null;
}
