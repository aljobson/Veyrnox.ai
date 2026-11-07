import { mp4Seconds, wavSeconds, mp3Seconds } from './mediaLength.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { presignGetUrl } from '../packages/adapters/r2.js';

export const SPEECH_PROBE_MAX_BYTES = 5 * 1024 * 1024;
const MP4 = new Set(['video/mp4', 'video/quicktime', 'audio/mp4', 'audio/x-m4a']);
/** Ownership must already have been checked by get_user_asset. Never accepts a caller URL. */
export async function probeSpeechSource(asset, r2cfg, { sign = presignGetUrl, fetcher = fetchWithTimeout } = {}) {
    const size = Number(asset.size_bytes), mime = asset.mime_type;
    if (!Number.isSafeInteger(size) || size <= 0 || !/^[0-9a-f]{64}$/i.test(asset.sha256 || '')) return null;
    if (!MP4.has(mime) && !['audio/wav', 'audio/x-wav', 'audio/mpeg'].includes(mime)) return null;
    const { url } = await sign(asset.r2_key, 300, r2cfg);
    let budget = SPEECH_PROBE_MAX_BYTES;
    const until = Date.now() + 15000;
    const read = async (start, end) => {
        const length = end - start + 1;
        if (length < 1 || length > budget || Date.now() >= until) throw new Error('probe_limit');
        budget -= length;
        const response = await fetcher(url, { redirect: 'error', headers: { Range: `bytes=${start}-${end}` } }, Math.min(5000, until - Date.now()), length);
        if (response.status !== 206 && !(start === 0 && end === size - 1 && response.status === 200)) throw new Error('probe_range');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== length) throw new Error('probe_length');
        return bytes;
    };
    try {
        let duration;
        if (MP4.has(mime)) duration = await mp4Seconds(read, size);
        else if (mime === 'audio/mpeg') duration = size <= SPEECH_PROBE_MAX_BYTES ? mp3Seconds(await read(0, size - 1), size) : null;
        else duration = wavSeconds(await read(0, Math.min(size, 64 * 1024) - 1), size);
        return Number.isFinite(duration) && duration > 0 ? { duration, mime, fingerprint: asset.sha256.toLowerCase() } : null;
    } catch { return null; }
}
