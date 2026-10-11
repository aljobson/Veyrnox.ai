import { Input, BufferSource, MP4, EncodedPacketSink } from 'mediabunny';
import { mp4Info } from './mediaLength.js';
import { sniffType } from './uploadSource.js';

export const FILM_MASTER_MAX_BYTES = 25 * 1024 * 1024;
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta']);
function boundedBoxes(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let count = 0, movies = 0;
    function walk(start, end, depth) {
        if (depth > 8) return false;
        let at = start;
        while (at < end) {
            if (++count > 256 || at + 8 > end) return false;
            let size = view.getUint32(at), header = 8;
            if (size === 1) { if (at + 16 > end) return false; size = Number(view.getBigUint64(at + 8)); header = 16; }
            if (size === 0) size = end - at;
            if (!Number.isSafeInteger(size) || size < header || at + size > end) return false;
            const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
            if (type === 'moof' || type === 'mvex') return false;
            if (type === 'moov' && (++movies !== 1 || size > 4 * 1024 * 1024)) return false;
            if (CONTAINERS.has(type) && !walk(at + header, at + size, depth + 1)) return false;
            at += size;
        }
        return at === end;
    }
    return walk(0, bytes.length, 0) && movies === 1;
}

// Structural inspection of every packet, not a server-side decode or malware verdict.
// Browser export independently probes the decoded result before offering Save.
export async function inspectFilmMaster(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > FILM_MASTER_MAX_BYTES
        || sniffType(bytes.subarray(0, 16)) !== 'video/mp4' || !boundedBoxes(bytes)) return null;
    const info = await mp4Info(async (start, end) => bytes.subarray(start, end + 1), bytes.length);
    if (!info || info.width !== 1920 || info.height !== 1080 || info.seconds > 60) return null;
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
    try {
        const tracks = await input.getTracks();
        const video = tracks.filter(t => t.type === 'video');
        const audio = tracks.filter(t => t.type === 'audio');
        if (video.length !== 1 || audio.length > 1 || tracks.length !== video.length + audio.length) return null;
        const track = video[0];
        const config = await track.getDecoderConfig();
        if (await track.getCodec() !== 'avc' || config?.codedWidth !== 1920 || config?.codedHeight !== 1080
            || await track.getDisplayWidth() !== 1920 || await track.getDisplayHeight() !== 1080) return null;
        if (audio.length && await audio[0].getCodec() !== 'aac') return null;
        let frames = 0, first = Infinity, end = 0;
        const timestamps = [];
        for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { verifyKeyPackets: true })) {
            if (++frames > 1440 || !packet.data.length || !Number.isFinite(packet.timestamp)
                || Math.abs(packet.duration - 1 / 24) > 0.0001) return null;
            first = Math.min(first, packet.timestamp); end = Math.max(end, packet.timestamp + packet.duration);
            timestamps.push(packet.timestamp);
        }
        const seconds = frames / 24;
        timestamps.sort((a, b) => a - b);
        if (!frames || timestamps.some((time, i) => Math.abs(time - i / 24) > 0.0001)
            || Math.abs(first) > 0.0001 || Math.abs(end - seconds) > 0.001
            || Math.abs(info.seconds - seconds) > 0.06) return null;
        return { width: 1920, height: 1080, frame_rate: 24, seconds };
    } catch { return null; }
    finally { input.dispose(); }
}
