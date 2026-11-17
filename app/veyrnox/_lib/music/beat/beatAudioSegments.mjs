export const tickSeconds = (ticks, tempo) => ticks / 960 * 60 / (typeof tempo === 'number' ? tempo : tempo.bpm);
export const modulo = (n, length) => ((n % length) + length) % length;
const clamp = (v) => Math.max(0, Math.min(1, v));
export function envelopeGain(region, t, tempo) {
  const length = tickSeconds(region.length, tempo);
  const a = region.fadeIn, b = region.fadeOut;
  return 10 ** (region.gainDb / 20)
    * (a ? clamp((t - a.startSec) / (a.endSec - a.startSec)) : 1)
    * (b ? clamp((length - t - b.endBeforeEndSec) / (b.startBeforeEndSec - b.endBeforeEndSec)) : 1);
}
export function audioSegments(doc, fromSec, toSec, { tempo = doc.tempo.bpm, includeMuted = false } = {}) {
  return segments(doc, fromSec, toSec, { tempo, includeMuted, startSec: fromSec, endSec: toSec });
}
// Playback admits whole pieces by start time, while export/partition queries clip
// to their window. Only a transport start or cycle wrap may synthesize a mid-piece start.
export function audioPieces(doc, fromSec, toSec, { startSec = 0, endSec = Infinity, tempo = doc.tempo.bpm, includeMuted = false } = {}) {
  return segments(doc, fromSec, toSec, { tempo, startSec, endSec, startsOnly: true, includeMuted });
}
function segments(doc, fromSec, toSec, { tempo, startSec, endSec, startsOnly = false, includeMuted = false }) {
  const segments = [], solo = doc.tracks.some((t) => t.solo);
  for (const track of doc.tracks) {
    if (track.kind !== 'audio' || (!includeMuted && (track.mute || (solo && !track.solo)))) continue;
    for (const region of track.regions) {
      const asset = doc.assets[region.assetId];
      const start = tickSeconds(region.start, tempo), end = start + tickSeconds(region.length, tempo);
      const duration = asset.source === 'sound' ? tickSeconds(asset.durationSec * doc.tempo.bpm / 60 * 960, tempo) : asset.durationSec;
      const phase = asset.source === 'sound' ? tickSeconds(region.phaseTicks, tempo) : region.phaseSec;
      let at = Math.max(fromSec, start);
      const extendedEnd = end + (region.tailSec || 0);
      const until = Math.min(endSec, extendedEnd);
      if (startsOnly && at > Math.max(startSec, start) + 1e-9) {
        const offset = modulo(phase + at - start, duration);
        if (offset > 1e-9 && duration - offset > 1e-9) at += duration - offset;
      }
      while (at < Math.min(toSec, until) - 1e-10) {
        let offset = modulo(phase + at - start, duration);
        if (offset < 1e-9 || duration - offset < 1e-9) offset = 0;
        const length = Math.min(duration - offset, until - at);
        segments.push({ regionId: region.id, trackId: track.id, assetId: region.assetId,
          songTimeSec: at, offsetSec: offset, durationSec: length, reverse: region.reverse,
          gain: envelopeGain(region, at - start, tempo), endGain: envelopeGain(region, at + length - start, tempo),
          regionTimeSec: at - start, isRegionStart: Math.abs(at - start) < 1e-9, isRegionEnd: Math.abs(at + length - extendedEnd) < 1e-9 });
        at += length;
      }
    }
  }
  return segments.sort((a, b) => a.songTimeSec - b.songTimeSec || a.regionId.localeCompare(b.regionId));
}
// Q2: offsets index R itself, independent of scheduler slicing. No per-slice remapping.
export const reverseOffset = (phase) => phase;
export function songWindowToContext(from, to, { startSec = 0, contextStart = 0, cycle = null, endSec = Infinity } = {}) {
  const result = [];
  let at = from;
  while (at < to - 1e-10) {
    let song = startSec + at;
    if (cycle && song >= cycle.end) song = cycle.start + modulo(song - cycle.end, cycle.end - cycle.start);
    const duration = Math.min(to - at, (cycle ? cycle.end : endSec) - song);
    if (duration <= 1e-10) break;
    result.push({ fromSec: song, toSec: song + duration, contextTime: contextStart + at });
    at += duration;
  }
  return result;
}
// Clip retains the original envelope at every retained point, including partial ramps.
export function audioFragment(region, start, length, asset, tempo) {
  const elapsed = tickSeconds(start - region.start, tempo);
  const removedEnd = tickSeconds(region.start + region.length - start - length, tempo);
  let fadeIn = region.fadeIn && { startSec: region.fadeIn.startSec - elapsed, endSec: region.fadeIn.endSec - elapsed };
  let fadeOut = region.fadeOut && { startBeforeEndSec: region.fadeOut.startBeforeEndSec - removedEnd, endBeforeEndSec: region.fadeOut.endBeforeEndSec - removedEnd };
  if (fadeIn && fadeIn.endSec <= 0) fadeIn = null;
  if (region.tailSec) fadeOut = removedEnd > 1e-9 ? null : region.fadeOut;
  else if (fadeOut && fadeOut.startBeforeEndSec <= 0) fadeOut = null;
  const phase = asset.source === 'sound' ? { phaseTicks: modulo(region.phaseTicks + start - region.start, Math.round(asset.durationSec * tempo / 60 * 960)) }
    : { phaseSec: modulo(region.phaseSec + elapsed, asset.durationSec) };
  const result = { ...region, start, length, ...phase, fadeIn, fadeOut };
  if (region.tailSec && removedEnd > 1e-9) delete result.tailSec;
  return result;
}
export function clampFades(region, tempo) {
  const length = tickSeconds(region.length, tempo);
  const a = region.fadeIn, b = region.fadeOut;
  const plainIn = a?.startSec === 0, plainOut = b?.endBeforeEndSec === 0;
  // Partial ramps encode a cut in an existing envelope. Keep their anchors;
  // only newly authored, plain ramps may be shortened to fit the region.
  const inSpan = a ? Math.max(0, Math.min(length, a.endSec) - Math.max(0, a.startSec)) : 0;
  const outSpan = b ? Math.max(0, Math.min(length, b.startBeforeEndSec) - Math.max(0, b.endBeforeEndSec)) : 0;
  const fixed = (plainIn ? 0 : inSpan) + (plainOut ? 0 : outSpan);
  const authored = (plainIn ? inSpan : 0) + (plainOut ? outSpan : 0);
  const scale = authored ? Math.min(1, Math.max(0, length - fixed) / authored) : 1;
  if (plainIn) region.fadeIn = inSpan * scale > 0 ? { startSec: 0, endSec: inSpan * scale } : null;
  if (plainOut) region.fadeOut = outSpan * scale > 0 ? { startBeforeEndSec: outSpan * scale, endBeforeEndSec: 0 } : null;
}
