import { mp3FrameCounter } from '../../../../../lib/mediaLength.js';
import { probeAudioHeader, admitProbe } from './beatAudioProbe.mjs';
import { admitScan, admitDecode, checkDecoded, reservationPool, MB } from './beatAudioRules.mjs';
export const scans = reservationPool(2, 240 * MB);
export const decodes = reservationPool(2, 600 * MB);
async function readBounded(response, bound, prefix = false) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('This browser cannot read audio safely.');
  const bytes = new Uint8Array(bound); let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!prefix && length + value.length > bound) throw new Error('This sound changed size since it was added');
      const piece = value.subarray(0, bound - length); bytes.set(piece, length); length += piece.length;
      if (prefix && length === bound) break;
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock?.(); }
  }
  return bytes.subarray(0, length);
}
async function request(fetchAudio, url, range = false) {
  let response;
  try { response = await fetchAudio(url, { credentials: 'same-origin', ...(range ? { headers: { Range: 'bytes=0-65535' } } : {}) }); }
  catch (cause) {
    if (cause.name === 'AbortError') throw cause;
    throw new Error('Could not load this song. Try again.', { cause });
  }
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error([403, 404, 410].includes(response.status)
      ? 'This song version is no longer available' : 'Could not load this song. Try again.');
    error.status = response.status; throw error;
  }
  return response;
}
export async function fetchAudioAsset(url, base, stored, { fetchAudio = fetch, decode }) {
  if (stored) admitDecode(stored);
  const response = await request(fetchAudio, url, true);
  // The range reply supplies header bytes only. Content-Range is not CORS-safelisted.
  const prefix = await readBounded(response, 65536, true);
  const full = await request(fetchAudio, url);
  const total = Number(full.headers.get('Content-Length'));
  try { admitScan(total); } catch (e) { await full.body?.cancel(); throw e; }
  // Keep a cold load inside its preflight allocation. This is a capacity bound,
  // not a byte-for-byte drift test: smaller encodings still pass the exact-duration check.
  if (stored && total > stored.encodedBytes) { await full.body?.cancel(); throw new Error('This sound changed size since it was added'); }
  const releaseScan = await scans.acquire(total);
  let bytes;
  try {
    let probe = probeAudioHeader(prefix, total);
    if (!probe.needsFullHeader) admitProbe(probe);
    let provisional = { ...base, sourceChannels: probe.channels, durationSec: probe.durationSec, encodedBytes: total };
    // WAV/FLAC can fail stage 2 before their full body is fetched. MP3 is measured first.
    if (!probe.needsFullHeader && probe.container !== 'mp3') admitDecode(provisional);
    bytes = await readBounded(full, total);
    if (bytes.length !== total) throw new Error('This sound changed size since it was added');
    if (probe.needsFullHeader) {
      probe = probeAudioHeader(bytes, total); admitProbe(probe);
      provisional = { ...provisional, sourceChannels: probe.channels, durationSec: probe.durationSec };
    }
    if (probe.container === 'mp3') {
      const counter = mp3FrameCounter();
      for (let at = 0; at < bytes.length; at += 65536) {
        counter.push(bytes.subarray(at, at + 65536));
        if (at % 1048576 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      provisional.durationSec = counter.end(); // measured count always wins over Xing/VBRI hints
    }
    const reserve = admitDecode(provisional);
    if (stored && (stored.sourceChannels !== provisional.sourceChannels || Math.abs(stored.durationSec - provisional.durationSec) > stored.durationSec * 0.02)) throw new Error('This sound changed size since it was added');
    const releaseDecode = await decodes.acquire(reserve);
    try {
      const buffer = await decode(bytes.buffer);
      checkDecoded(buffer, provisional);
      if (stored) checkDecoded(buffer, stored);
      return { asset: provisional, buffer };
    } finally { releaseDecode(); }
  } finally { await full.body?.cancel().catch(() => {}); bytes = null; releaseScan(); }
}
