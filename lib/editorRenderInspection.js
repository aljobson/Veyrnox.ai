import { Input, BufferSource, MP4, EncodedPacketSink } from 'mediabunny';
import { mp4Info } from './mediaLength.js';
import { sniffType } from './uploadSource.js';
export const EDITOR_RENDER_MAX_BYTES = 25 * 1024 * 1024;
const RATES = [24, 25, 30, 50, 60];
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta']);

// Bound atom traversal independently of the demuxer and reject fragments.
function boundedBoxes(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let count = 0, movies = 0;
    function walk(start, end, depth) {
        if (depth > 8) return false;
        for (let at = start; at < end;) {
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
        return true;
    }
    return walk(0, bytes.length, 0) && movies === 1;
}

/** Format/packet inspection, not decoding, malware scanning or moderation. */
export async function inspectEditorRender(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > EDITOR_RENDER_MAX_BYTES
        || sniffType(bytes.subarray(0, 16)) !== 'video/mp4' || !boundedBoxes(bytes)) return null;
    const info = await mp4Info(async (start, end) => bytes.subarray(start, end + 1), bytes.length);
    if (!info || !(info.seconds > 0 && info.seconds <= 600.1)
        || !Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1 || Math.max(info.width, info.height) > 4096) return null;
    const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
    try {
        const tracks = await input.getTracks(), video = tracks.filter(t => t.type === 'video'), audio = tracks.filter(t => t.type === 'audio');
        if (video.length !== 1 || audio.length > 1 || tracks.length !== video.length + audio.length) return null;
        const track = video[0], config = await track.getDecoderConfig();
        if (await track.getCodec() !== 'avc' || config?.codedWidth !== info.width || config?.codedHeight !== info.height
            || await track.getDisplayWidth() !== info.width || await track.getDisplayHeight() !== info.height) return null;
        const packets = [];
        for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { verifyKeyPackets: true })) {
            if (packets.length >= 36000 || !packet.data.length || !Number.isFinite(packet.timestamp) || !(packet.duration > 0 && packet.duration <= 1 / 24 + 0.0001)) return null;
            packets.push({ at: packet.timestamp, duration: packet.duration });
        }
        packets.sort((a, b) => a.at - b.at);
        if (!packets.length || Math.abs(packets[0].at) > 0.0001) return null;
        const rate = RATES.find(n => packets.every((p, i) => Math.abs(p.at - i / n) < 0.0001 && (i === packets.length - 1 ? p.duration <= 1 / n + 0.0001 : Math.abs(p.duration - 1 / n) < 0.0001)));
        if (!rate) return null;
        const seconds = packets.at(-1).at + packets.at(-1).duration;
        if (!(seconds > 0 && seconds <= 600) || Math.abs(info.seconds - seconds) > 0.1) return null;
        if (audio.length) {
            if (await audio[0].getCodec() !== 'aac') return null;
            let count = 0;
            for await (const packet of new EncodedPacketSink(audio[0]).packets()) {
                if (++count > 60000 || !packet.data.length || !Number.isFinite(packet.timestamp) || !(packet.duration > 0)
                    || packet.timestamp < -0.1 || packet.timestamp + packet.duration > seconds + 0.1) return null;
            }
            if (!count) return null;
        }
        return { width: info.width, height: info.height, seconds, frame_rate: rate };
    } catch { return null; }
    finally { input.dispose(); }
}
