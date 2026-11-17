import { edit, trackById, nextId, BeatRefusal } from './beatOps.mjs';
import { audioFragment, tickSeconds } from './beatAudioSegments.mjs';
const overlaps = (r, start, length) => r.start < start + length && r.start + r.length > start;
const groupOf = (d, trackId, groupId) => {
  const track = trackById(d, trackId), group = track.takeGroups?.find(g => g.id === groupId);
  if (!group) throw new BeatRefusal('That take group no longer exists.');
  return { track, group };
};
function cutRange(d, track, start, length) {
  const survivors = [];
  for (const r of [...track.regions]) {
    if (!overlaps(r, start, length)) { survivors.push(r); continue; }
    if (r.start < start) survivors.push(audioFragment(r, r.start, start - r.start, d.assets[r.assetId], d.tempo.bpm));
    if (r.start + r.length > start + length) {
      const right = audioFragment(r, start + length, r.start + r.length - start - length, d.assets[r.assetId], d.tempo.bpm);
      if (r.start < start) { right.id = nextId(d, 'r'); track.regions.push(right); }
      survivors.push(right);
    }
  }
  track.regions = survivors;
}
function materialize(d, trackId, groupId) {
  const { track, group: g } = groupOf(d, trackId, groupId), bpm = d.tempo.bpm;
  cutRange(d, track, g.start, g.length);
  const pieces = [];
  for (let i = 0; i < g.comp.length; i++) {
    const [start, lane] = g.comp[i], end = g.comp[i + 1]?.[0] ?? g.start + g.length;
    const assetId = g.lanes[lane], asset = d.assets[assetId], phaseSec = tickSeconds(start - g.start, bpm);
    const available = Math.floor((asset.durationSec - phaseSec + 1e-9) / tickSeconds(240, bpm)) * 240;
    const length = Math.min(end - start, available);
    if (length < 240) continue;
    let id = `${g.id}s${i.toString(36)}`;
    const used = new Set(d.tracks.flatMap(t => t.regions.map(r => r.id)));
    while (used.has(id)) id += 'x';
    const region = { id, start, length, assetId, phaseSec, gainDb: 0, reverse: false, fadeIn: null, fadeOut: null };
    const previous = pieces.at(-1), x = g.xfadeMs / 1000;
    if (x && previous && previous.start + previous.length === start && previous.assetId !== assetId) {
      const remaining = d.assets[previous.assetId].durationSec - previous.phaseSec - tickSeconds(previous.length, bpm);
      const tail = Math.min(x, remaining);
      if (tail >= 0.001) {
        previous.tailSec = tail;
        previous.fadeOut = { startBeforeEndSec: 0, endBeforeEndSec: -tail };
      } else previous.fadeOut = { startBeforeEndSec: 0.001, endBeforeEndSec: 0 };
      region.fadeIn = { startSec: 0, endSec: x };
    }
    pieces.push(region);
  }
  track.regions.push(...pieces); track.regions.sort((a, b) => a.start - b.start);
}
export const materializeGroup = (doc, trackId, groupId, now = Date.now()) => edit(doc, now, d => materialize(d, trackId, groupId), { takeOp: true });
// A single (cycle-off) pass learns its final length only after the performance. It appends
// to an identical-range group like any recording, but replaces that group when it is full,
// so commit never refuses audio already performed (review P9-001 / REVIEW-002).
export function recordingCapacity(doc, trackId, { start, length, single = false }) {
  const track = doc.tracks.find(t => t.id === trackId);
  let reason = '';
  if (doc.version !== 4 || track?.kind !== 'audio') reason = 'Arm an audio track to record.';
  if (![start, length].every(n => Number.isSafeInteger(n) && n % 240 === 0) || start < 0 || length < 240 || start + length > Math.min(512 * 3840, 600 * doc.tempo.bpm * 16)) reason = 'Recording exceeds the song limit.';
  if (reason) return { lanes: 0, reason };
  const match = track.takeGroups?.find(g => g.start === start && g.length === length);
  const same = single && match && (match.lanes.length >= 8 || Object.keys(doc.assets).length >= 64) ? null : match;
  const groups = (track.takeGroups || []).filter(g => !overlaps(g, start, length));
  if (!same && groups.length >= 16) reason = 'Take group limit reached — 16 groups per track.';
  // Count the actual surviving fragments, including a region split around the range.
  let regions = doc.tracks.filter(t => t.id !== trackId).reduce((n, t) => n + t.regions.length, 0) + 1;
  for (const r of track.regions) regions += !overlaps(r, start, length) ? 1 : Number(r.start < start) + Number(r.start + r.length > start + length);
  if (regions > 400) reason = 'Region limit reached — 400 regions per song.';
  const lanes = Math.min(8 - (same?.lanes.length || 0), 64 - Object.keys(doc.assets).length);
  if (lanes <= 0) reason = same?.lanes.length === 8 ? 'Take limit reached — 8 takes per section.' : 'Asset limit reached — 64 sounds per song.';
  return { lanes: reason ? 0 : lanes, reason, appendTo: same?.id };
}
export function commitRecording(doc, { trackId, start, length, takes, appendTo, single = false }, now = Date.now()) {
  const capacity = recordingCapacity(doc, trackId, { start, length, single });
  if (!takes.length) return doc;
  if (capacity.reason || takes.length > capacity.lanes) throw new BeatRefusal(capacity.reason || 'Take limit reached — 8 takes per section.');
  if (appendTo && capacity.appendTo !== appendTo) throw new BeatRefusal('The take range changed. Try again.');
  return edit(doc, now, d => {
    const track = trackById(d, trackId);
    let group = track.takeGroups?.find(g => g.id === capacity.appendTo);
    if (!group) {
      track.takeGroups = (track.takeGroups || []).filter(g => !overlaps(g, start, length));
      group = { id: nextId(d, 'g'), start, length, lanes: [], comp: [], xfadeMs: 10 };
      track.takeGroups.push(group);
    }
    for (const take of takes) {
      const id = nextId(d, 'a'); d.assets[id] = structuredClone(take.asset); group.lanes.push(id);
    }
    group.comp = [[start, group.lanes.length - 1]];
    materialize(d, trackId, group.id);
  }, { takeOp: true });
}
function changeGroup(doc, trackId, groupId, change) {
  return edit(doc, Date.now(), d => { const { group } = groupOf(d, trackId, groupId); change(group); materialize(d, trackId, groupId); }, { takeOp: true });
}
export function setComp(doc, trackId, groupId, from, to, lane) {
  return changeGroup(doc, trackId, groupId, g => {
    if (!Number.isInteger(lane) || !g.lanes[lane] || from < g.start || to > g.start + g.length || from % 240 || to % 240 || to - from < 240) throw new BeatRefusal('Choose a range of at least one step inside the take group.');
    const after = [...g.comp].reverse().find(([at]) => at <= to)?.[1];
    const comp = g.comp.filter(([at]) => at < from || at >= to);
    comp.push([from, lane]);
    if (to < g.start + g.length && !comp.some(([at]) => at === to)) comp.push([to, after]);
    comp.sort((a, b) => a[0] - b[0]); g.comp = comp.filter((p, i) => !i || p[1] !== comp[i - 1][1]);
  });
}
export const useWholeTake = (doc, trackId, groupId, lane) => { const { group } = groupOf(doc, trackId, groupId); return setComp(doc, trackId, groupId, group.start, group.start + group.length, lane); };
export const setCrossfade = (doc, trackId, groupId, ms) => changeGroup(doc, trackId, groupId, g => { g.xfadeMs = ms; });
export const flattenGroup = (doc, trackId, groupId) => edit(doc, Date.now(), d => {
  const { track } = groupOf(d, trackId, groupId);
  track.takeGroups = track.takeGroups.filter(g => g.id !== groupId);
  if (!track.takeGroups.length) delete track.takeGroups;
}, { takeOp: true });
export const deleteLane = (doc, trackId, groupId, lane) => changeGroup(doc, trackId, groupId, g => {
  if (!Number.isInteger(lane) || !g.lanes[lane] || g.lanes.length === 1) throw new BeatRefusal('Keep at least one take.');
  g.lanes.splice(lane, 1);
  g.comp = g.comp.map(([at, n]) => [at, n === lane ? g.lanes.length - 1 : n > lane ? n - 1 : n]).filter((p, i, all) => !i || p[1] !== all[i - 1][1]);
});
