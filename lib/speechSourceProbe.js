import { mp4Info, wavSeconds, mp3Seconds } from './mediaLength.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { presignGetUrl } from '../packages/adapters/r2.js';

export const SPEECH_PROBE_MAX_BYTES = 5 * 1024 * 1024;
// Keep in sync with speech_source_probe_store / speech_analysis_request in 0451.
export const SPEECH_SOURCE_MAX_BYTES = 100 * 1024 * 1024;
export const SPEECH_SOURCE_MAX_BYTES_PER_SECOND = 2 * 1024 * 1024;
export function speechSourceSizeAllowed(asset, duration) {
    const size = Number(asset.size_bytes);
    return Number.isSafeInteger(size) && size > 0 && size <= SPEECH_SOURCE_MAX_BYTES
        && (duration === undefined || (Number.isFinite(duration) && duration > 0 && size <= duration * SPEECH_SOURCE_MAX_BYTES_PER_SECOND));
}
/**
 * Why a source was refused, so the app can say so. The size and bitrate bounds are the same
 * ones speechSourceSizeAllowed enforces; everything else (no stored size or hash, a container
 * or codec the probe cannot read, a fragmented MP4) is "unreadable".
 */
export function speechSourceRefusal(asset, duration) {
    const size = Number(asset?.size_bytes), mb = n => Math.round(n / 1048576 * 10) / 10;
    if (!Number.isSafeInteger(size) || size <= 0) return { error: 'source_unreadable', reason: 'no_size' };
    if (size > SPEECH_SOURCE_MAX_BYTES) return { error: 'source_too_large', size_mb: mb(size), max_mb: mb(SPEECH_SOURCE_MAX_BYTES) };
    if (Number.isFinite(duration) && duration > 0 && size > duration * SPEECH_SOURCE_MAX_BYTES_PER_SECOND) {
        return { error: 'source_bitrate_too_high', size_mb: mb(size), seconds: Math.round(duration * 10) / 10 };
    }
    return { error: 'source_unreadable', reason: /^[0-9a-f]{64}$/i.test(asset?.sha256 || '') ? 'probe_failed' : 'no_hash' };
}
const MP4 = new Set(['video/mp4', 'video/quicktime', 'audio/mp4', 'audio/x-m4a']);
/** Ownership must already have been checked by get_user_asset. Never accepts a caller URL. */
export async function probeSpeechSource(asset, r2cfg, { sign = presignGetUrl, fetcher = fetchWithTimeout } = {}) {
    const size = Number(asset.size_bytes), mime = asset.mime_type;
    if (!speechSourceSizeAllowed(asset) || !/^[0-9a-f]{64}$/i.test(asset.sha256 || '')) return null;
    if (!MP4.has(mime) && !['audio/wav', 'audio/x-wav', 'audio/mpeg'].includes(mime)) return null;
    const signed = await sign(asset.r2_key, 300, r2cfg).catch(() => null);
    if (!signed?.url) return null;
    const { url } = signed;
    let budget = SPEECH_PROBE_MAX_BYTES;
    const until = Date.now() + 15000;
    const read = async (start, end) => {
        const length = end - start + 1;
        if (length < 1 || length > budget || Date.now() >= until) throw new Error('probe_limit');
        budget -= length;
        const response = await fetcher(url, { redirect: 'error', headers: { Range: `bytes=${start}-${end}`, ...(asset.etag ? { 'If-Match': asset.etag } : {}) } }, Math.min(5000, until - Date.now()), length);
        if (response.status !== 206 && !(start === 0 && end === size - 1 && response.status === 200)) throw new Error('probe_range');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== length) throw new Error('probe_length');
        return bytes;
    };
    try {
        let duration, audio = true;
        if (MP4.has(mime)) {
            const info = await mp4Info(read, size);
            duration = info ? info.seconds : null;
            // false only when every track handler was read and none is sound; null (unknown) stays admissible.
            if (info && mime.startsWith('video/') && info.audio === false) audio = false;
        }
        else if (mime === 'audio/mpeg') duration = size <= SPEECH_PROBE_MAX_BYTES ? mp3Seconds(await read(0, size - 1), size) : null;
        else duration = wavSeconds(await read(0, Math.min(size, 64 * 1024) - 1), size);
        return Number.isFinite(duration) && speechSourceSizeAllowed(asset, duration) ? { duration, mime, fingerprint: asset.sha256.toLowerCase(), audio } : null;
    } catch { return null; }
}
