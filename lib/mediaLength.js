/**
 * Playing time of an uploaded audio or video file.
 *
 * Pure: bytes in, seconds out. Lip-sync models bill by output seconds, so the
 * gateway caps a source's length before the debit (ADR-0028). Every function
 * returns null when the length cannot be established, and the caller refuses
 * the source: a guessed length is a guessed price.
 *
 * The length is taken from what a decoder plays, never from a field that only
 * describes the file (ADR-0028, amendment of 2026-10-09). A WAV byte rate, an MP3 Xing
 * frame count and an MP4 movie duration are written by whoever made the file
 * and can say ten seconds over an hour of audio. So: a WAV is its bytes over
 * its sample rate and frame size, an MP3 is its frames counted one by one,
 * and an MP4 is the longest of its movie header, its track headers and each
 * track's sample table. A file whose samples live outside that table
 * (fragmented MP4) is refused.
 */

const u32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u64 = (b, i) => u32(b, i) * 2 ** 32 + u32(b, i + 4);
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const ascii = (b, i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

// Formats whose frame size is fixed, so bytes divide into seconds exactly: PCM, float, A-law, mu-law, extensible.
const WAV_FIXED_FRAME = new Set([1, 3, 6, 7, 0xfffe]);

/**
 * WAV: the bytes after the data chunk's header over (sample rate x frame size).
 * The byte-rate field is not read, and neither is the data chunk's declared
 * size: everything up to the end of the file is counted as audio.
 */
export function wavSeconds(b, totalBytes) {
    if (!(b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE'))) return null;
    let bytesPerSecond = 0;
    for (let i = 12; i + 8 <= b.length;) {
        const size = le32(b, i + 4);
        if (ascii(b, i, 'fmt ') && i + 24 <= b.length) {
            if (!WAV_FIXED_FRAME.has(le16(b, i + 8))) return null;
            const fromBits = le16(b, i + 10) * Math.ceil(le16(b, i + 22) / 8);
            const frame = Math.min(le16(b, i + 20) || Infinity, fromBits || Infinity);
            bytesPerSecond = Number.isFinite(frame) ? le32(b, i + 12) * frame : 0;
        }
        if (ascii(b, i, 'data')) {
            const dataBytes = totalBytes - (i + 8);
            return bytesPerSecond && dataBytes > 0 ? dataBytes / bytesPerSecond : null;
        }
        i += 8 + size + (size & 1);
    }
    return null;
}

// MPEG-1/2/2.5 Layer III tables.
const BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The MPEG audio frame starting at `i`: its length in bytes and seconds, `'unsupported'`, or null when none starts there. */
function mpegFrame(b, i) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
    const version = (b[i + 1] >> 3) & 3;           // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const index = b[i + 2] >> 4;
    const rate = (RATES[version] || [])[(b[i + 2] >> 2) & 3];
    if (!rate || index === 15) return null;
    // Layer I or II, or a free-format bitrate: a decoder may play it, and its length is not counted here.
    if (((b[i + 1] >> 1) & 3) !== 1 || index === 0) return 'unsupported';
    const samples = version === 3 ? 1152 : 576;
    const kbps = BITRATES[version === 3 ? 1 : 2][index];
    return { bytes: Math.floor(((samples / 8) * kbps * 1000) / rate) + ((b[i + 2] >> 1) & 1), seconds: samples / rate };
}

/**
 * MP3: every Layer III frame in the file, counted. Needs the whole file: a
 * partial read is null. A Xing or VBRI frame count is not read. Bytes that
 * are not a frame are stepped over one at a time, as a decoder resyncs.
 */
export function mp3Seconds(b, totalBytes) {
    if (b.length < totalBytes) return null;
    let i = 0;
    if (b.length >= 10 && ascii(b, 0, 'ID3')) {
        i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
    }
    let seconds = 0;
    while (i + 4 <= b.length) {
        const frame = mpegFrame(b, i);
        if (frame === 'unsupported') return null;
        if (!frame) { i += 1; continue; }
        seconds += frame.seconds;
        i += frame.bytes;
    }
    return seconds > 0 ? seconds : null;
}

const MOOV_MAX_BYTES = 4 * 1024 * 1024;
const TOP_LEVEL_MAX_BOXES = 64;

/** The boxes directly inside [start, end), or null when one runs past the end: a table cut short proves nothing. */
function children(b, start, end) {
    const found = [];
    for (let i = start; i + 8 <= end;) {
        let size = u32(b, i);
        let head = 8;
        if (size === 1) {
            if (i + 16 > end) return null;
            size = u64(b, i + 8);
            head = 16;
        }
        if (size === 0) size = end - i;
        if (size < head || i + size > end) return null;
        found.push({ type: String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]), start: i + head, end: i + size });
        i += size;
    }
    return found;
}

/** A length field and the timescale before it: 32-bit in version 0 boxes, 64-bit in version 1. */
function timed(b, box, v0Scale, v1Scale) {
    const v1 = b[box.start] === 1;
    const at = box.start + (v1 ? v1Scale : v0Scale);
    return at + (v1 ? 12 : 8) > box.end ? null : { scale: u32(b, at), duration: v1 ? u64(b, at + 4) : u32(b, at + 4) };
}

function moovInfo(moov) {
    const top = children(moov, 8, moov.length);
    const mvhd = top && top.find((x) => x.type === 'mvhd');
    const movie = mvhd && timed(moov, mvhd, 12, 20);
    // mvex: the samples are in fragments after the movie box, and no table here counts them.
    if (!movie || !movie.scale || top.some((x) => x.type === 'mvex')) return null;
    let seconds = movie.duration / movie.scale;
    let width = null;
    let height = null;
    for (const trak of top.filter((x) => x.type === 'trak')) {
        const inTrak = children(moov, trak.start, trak.end);
        if (!inTrak) return null;
        const tkhd = inTrak.find((x) => x.type === 'tkhd');
        if (tkhd) {
            const v1 = moov[tkhd.start] === 1;
            const at = tkhd.start + (v1 ? 28 : 20);
            if (at + (v1 ? 8 : 4) > tkhd.end) return null;
            seconds = Math.max(seconds, (v1 ? u64(moov, at) : u32(moov, at)) / movie.scale);
            // tkhd ends with width and height as 16.16 fixed point; an audio
            // track's are zero, so the first non-zero pair is the picture.
            const size = tkhd.start + (v1 ? 88 : 76);
            if (width === null && size + 8 <= tkhd.end) {
                const w = u32(moov, size) / 65536;
                const h = u32(moov, size + 4) / 65536;
                if (w > 0 && h > 0) { width = Math.round(w); height = Math.round(h); }
            }
        }
        const played = sampleTableSeconds(moov, inTrak);
        if (played === null) return null;
        seconds = Math.max(seconds, played);
    }
    return seconds > 0 ? { seconds, width, height } : null;
}

/** What a decoder plays from one track: its time-to-sample table summed. 0 for a track with no table; null when unreadable. */
function sampleTableSeconds(moov, inTrak) {
    const inside = (box, type) => {
        const kids = box && children(moov, box.start, box.end);
        return kids === null ? null : kids && kids.find((x) => x.type === type);
    };
    const mdia = inTrak.find((x) => x.type === 'mdia');
    if (!mdia) return 0;
    const mdhd = inside(mdia, 'mdhd');
    const stts = inside(inside(inside(mdia, 'minf'), 'stbl'), 'stts');
    if (mdhd === null || stts === null) return null;
    if (!mdhd || !stts) return 0;
    const media = timed(moov, mdhd, 12, 20);
    if (!media || !media.scale || stts.start + 8 > stts.end) return null;
    const entries = u32(moov, stts.start + 4);
    if (stts.start + 8 + entries * 8 > stts.end) return null;
    let ticks = 0;
    for (let k = 0; k < entries; k += 1) {
        const at = stts.start + 8 + k * 8;
        ticks += u32(moov, at) * u32(moov, at + 4);
    }
    return ticks / media.scale;
}

/**
 * MP4: walk every top-level box, read `moov` whole, and take the length from
 * it (see the file header). `readRange` fetches [start, end] of the stored
 * file, so a `moov` placed after the media data costs ranged reads, not a
 * download. null for a fragmented file (`moof`), a `moov` over 4 MiB, or more
 * top-level boxes than a plain file has.
 * @param {(start:number, end:number) => Promise<Uint8Array>} readRange
 * @returns {Promise<{seconds:number, width:number|null, height:number|null}|null>}
 */
export async function mp4Info(readRange, totalBytes) {
    let info = null;
    let offset = 0;
    for (let boxes = 0; offset + 8 <= totalBytes; boxes += 1) {
        if (boxes >= TOP_LEVEL_MAX_BOXES) return null;
        const head = await readRange(offset, Math.min(offset + 16, totalBytes) - 1);
        if (head.length < 8) return null;
        let size = u32(head, 0);
        const type = String.fromCharCode(head[4], head[5], head[6], head[7]);
        if (size === 1) size = head.length >= 16 ? u64(head, 8) : 0;
        else if (size === 0) size = totalBytes - offset;
        if (size < 8 || type === 'moof') return null;
        if (type === 'moov') {
            if (info || size > MOOV_MAX_BYTES || offset + size > totalBytes) return null;
            info = moovInfo(await readRange(offset, offset + size - 1));
            if (!info) return null;
        }
        offset += size;
    }
    return info;
}

/** MP4 playing time in seconds, or null. */
export async function mp4Seconds(readRange, totalBytes) {
    const info = await mp4Info(readRange, totalBytes);
    return info ? info.seconds : null;
}
