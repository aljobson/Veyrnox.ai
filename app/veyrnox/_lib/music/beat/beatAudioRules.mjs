import { soundById, soundDuration, soundTicks } from './beatSounds.mjs';
export const AUDIO_RATE = 48000;
export const MB = 1000000;
const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const uuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
export function validAudioMetadata(a) {
  return !!a && finite(a.durationSec, Number.MIN_VALUE, 600) && [1, 2].includes(a.sourceChannels)
    && Number.isSafeInteger(a.encodedBytes) && a.encodedBytes >= 0 && a.encodedBytes <= 120 * MB;
}
export function validAsset(a, bpm) {
  if (!exact(a, ['source', 'ref', 'name', 'durationSec', 'bpm', 'sourceChannels', 'encodedBytes'])
    || !validAudioMetadata(a) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80
    || !(a.bpm === null || finite(a.bpm, Number.MIN_VALUE, Number.MAX_VALUE))) return false;
  if (a.source === 'sound') return !!soundById(a.ref) && a.sourceChannels === 2 && a.encodedBytes === 0
    && Math.abs(a.durationSec - soundDuration(a.ref, bpm)) < 1e-8;
  if (a.source === 'take') return typeof a.ref === 'string' && a.ref.length > 0 && a.ref.length <= 128 && !/[:/]/.test(a.ref) && a.sourceChannels === 1 && a.bpm === null;
  if (a.source === 'stem' || a.source === 'target') {
    const keys = a.source === 'stem' ? ['songId', 'versionId', 'requestId', 'part'] : ['songId', 'versionId', 'requestId', 'kind', 'instrument'];
    return exact(a.ref, keys) && ['songId', 'versionId', 'requestId'].every(k => uuid(a.ref[k]))
      && (a.source === 'stem' ? ['vocals', 'instrumental'].includes(a.ref.part)
        : ['target', 'residual'].includes(a.ref.kind) && ['vocals', 'drums', 'bass', 'guitar', 'piano', 'strings', 'synthesizer', 'brass', 'woodwinds'].includes(a.ref.instrument));
  }
  return a.source === 'song' && exact(a.ref, ['songId', 'versionId', 'jobId']) && Object.values(a.ref).every(uuid);
}
export function validRamp(r, fadeIn) {
  if (r === null) return true;
  const [a, b] = fadeIn ? ['startSec', 'endSec'] : ['startBeforeEndSec', 'endBeforeEndSec'];
  return exact(r, [a, b]) && finite(r[a], -600, 600) && finite(r[b], -600, 600)
    && (fadeIn ? r[b] > r[a] && r[b] >= 0 && r[b] - r[a] <= 10 : r[a] > r[b] && r[a] - r[b] <= 10);
}
export function validAudioRegion(r, asset) {
  const phase = asset?.source === 'sound' ? 'phaseTicks' : 'phaseSec';
  return !!asset && exact(r, ['id', 'start', 'length', 'assetId', phase, 'gainDb', 'fadeIn', 'fadeOut', 'reverse'])
    && finite(r.gainDb, -24, 6) && typeof r.reverse === 'boolean' && validRamp(r.fadeIn, true) && validRamp(r.fadeOut, false)
    && (phase === 'phaseTicks' ? Number.isInteger(r.phaseTicks) && r.phaseTicks >= 0 && r.phaseTicks < soundTicks(asset.ref)
      : finite(r.phaseSec, 0, asset.durationSec) && r.phaseSec < asset.durationSec);
}
export const pcmBytes = (a) => Math.ceil(a.durationSec * AUDIO_RATE) * a.sourceChannels * 4;
export const decodeReserve = (a) => a.encodedBytes + 2 * pcmBytes(a);
export function admitScan(encodedBytes) {
  if (!Number.isSafeInteger(encodedBytes) || encodedBytes <= 0 || encodedBytes > 120 * MB) throw new Error('Audio must be at most 120 MB, with a known size.');
  return encodedBytes;
}
export function admitDecode(a) {
  if (!validAudioMetadata(a)) throw new Error('Invalid or missing sound metadata (maximum duration: 600 seconds).');
  const reserve = decodeReserve(a);
  if (reserve > 300 * MB) throw new Error('This sound uses too much audio to load in this browser (over 300 MB).');
  return reserve;
}
export function checkDecoded(buffer, a) {
  if (buffer.numberOfChannels !== a.sourceChannels || buffer.sampleRate !== AUDIO_RATE
    || Math.abs(buffer.length - a.durationSec * AUDIO_RATE) > Math.max(1, a.durationSec * AUDIO_RATE * 0.02)) {
    throw new Error('This sound changed size since it was added');
  }
}
export function usedAssets(doc) {
  return [...new Set(doc.tracks.flatMap((t) => t.regions.map((r) => r.assetId).filter(Boolean)))];
}
export function estimateExport(doc, frames) {
  const ids = usedAssets(doc);
  const reversed = new Set(doc.tracks.flatMap((t) => t.regions.filter((r) => r.reverse).map((r) => r.assetId)));
  const assets = ids.map((id) => { const a = doc.assets?.[id]; admitDecode(a); return { id, a }; });
  const retained = assets.reduce((sum, { id, a }) => sum + pcmBytes(a) * (reversed.has(id) ? 2 : 1), 0);
  const reserves = assets.map(({ a }) => decodeReserve(a)).sort((a, b) => b - a).slice(0, 2);
  const bytes = retained + reserves.reduce((a, b) => a + b, 0) + frames * 2 * (4 + 2) + 44;
  if (bytes > 600 * MB) throw new Error(`This song uses too much audio to export in this browser (about ${Math.ceil(bytes / MB)} MB). Shorten it or remove some sounds.`);
  return bytes;
}
// Reservations are acquired before starting a scan/decode and always released in finally.
export function reservationPool(maxCount, maxBytes) {
  let count = 0, bytes = 0;
  const waiting = [];
  function drain() {
    while (waiting.length && count < maxCount && bytes + waiting[0].size <= maxBytes) {
      const { size, resolve } = waiting.shift(); count++; bytes += size;
      let released = false;
      resolve(() => { if (!released) { released = true; count--; bytes -= size; drain(); } });
    }
  }
  return {
    acquire(size) {
      if (!Number.isFinite(size) || size < 0 || size > maxBytes) return Promise.reject(new Error('Audio memory reservation exceeded.'));
      return new Promise((resolve) => { waiting.push({ size, resolve }); drain(); });
    },
    get usage() { return { count, bytes }; },
  };
}
