import { gatewayFetch } from '../../gateway.js';
import { privateMusicAssetPath } from '../../useMusicAudioSrc.jsx';
import { AUDIO_RATE, reservationPool } from './beatAudioRules.mjs';
import { extractStem, ZIP_LIMIT } from './beatZip.mjs';
import { assetSigningPath } from './beatAssetAvailability.mjs';
import { fetchAudioAsset, readBounded } from './beatAudioFetch.mjs';
export { decodes } from './beatAudioFetch.mjs';
const requests = new Set();
const zipScans = reservationPool(1, 240000000);
export function cancelSongLoads() { for (const controller of requests) controller.abort(); }
export const offline = (channels = 1, frames = 1) => {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("Sound isn't available in this browser");
  return new Offline(channels, frames, AUDIO_RATE);
};
export async function loadSong(base, stored = null) {
  const controller = new AbortController(), { signal } = controller;
  requests.add(controller);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const path = base.source === 'song' ? privateMusicAssetPath(`/api/v1/jobs/${base.ref.jobId}/asset`) : assetSigningPath(base);
        if (!path) throw new Error('This song version is no longer available');
        signal.throwIfAborted();
        const signed = await gatewayFetch(path, { signal });
        if (!signed?.url) throw new Error('This song version is no longer available');
        if (base.source === 'stem') return await decodeStem(signed, base, stored, signal);
        return await fetchAudioAsset(signed.url, base, stored, {
          fetchAudio: (url, options) => fetch(url, { ...options, signal }),
          decode: (bytes) => { signal.throwIfAborted(); return offline().decodeAudioData(bytes); },
        });
      } catch (error) {
        if (!signal.aborted && attempt === 0 && [401, 403].includes(error.status)) continue;
        throw error;
      }
    }
  } finally { requests.delete(controller); }
}

export const loadStem = loadSong;
export const loadTarget = loadSong;
async function decodeStem(signed, base, stored, signal) {
  const bound = Number(signed.size_bytes);
  if (!Number.isSafeInteger(bound) || bound <= 0 || bound > ZIP_LIMIT) throw Object.assign(new Error('Stem archive exceeds 120 MB'), { permanent: true });
  const release = await zipScans.acquire(bound * 2);
  try {
    const response = await fetch(signed.url, { signal, credentials: 'omit' });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Could not load this stem archive. Try again.'); }
    const archive = await readBounded(response, bound);
    const audio = await extractStem(archive, base.ref.part);
    // The existing probe/metadata/decode path remains authoritative for extracted audio.
    return await fetchAudioAsset('stem', base, stored, {
      fetchAudio: async (_url, options) => new Response(options.headers?.Range ? audio.subarray(0, 65536) : audio,
        { headers: { 'Content-Length': String(audio.length) } }),
      decode: bytes => { signal.throwIfAborted(); return offline().decodeAudioData(bytes); },
    });
  } finally { release(); }
}
