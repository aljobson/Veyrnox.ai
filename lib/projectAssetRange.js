import { fetchWithTimeout } from './fetchWithTimeout.js';

/** One bounded range; a whole-object response is never accepted. */
export async function readProjectAssetRange(url, start, end, totalBytes, signal) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= totalBytes || end - start >= 256 * 1024) throw Error('invalid_range');
  const res = await fetchWithTimeout(url, { redirect: 'manual', signal, headers: { Range: `bytes=${start}-${end}` } }, 8000, end - start + 1);
  if (res.status !== 206 || res.headers.get('content-range') !== `bytes ${start}-${end}/${totalBytes}`) throw Error('invalid_range_response');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length !== end - start + 1) throw Error('short_range');
  return bytes;
}
