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
 * track's sample table.
 *
 * A structure two readers would decode differently is refused, not measured
 * (ADR-0028, amendment of 2026-10-10): a WAV with a second format chunk, a
 * sample size that does not fit its format, or an extensible format whose
 * SubFormat is compressed or absent; an MP3 behind a malformed ID3 header or
 * padded with bytes that are mostly not frames; an MP4 track with a sample
 * table but no media header, a second sample table, or an edit list that is
 * anything but one plain edit.
 */

const u32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u64 = (b, i) => u32(b, i) * 2 ** 32 + u32(b, i + 4);
const i32 = (b, i) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const ascii = (b, i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

/**
 * A WAV sample's size in bytes for a format tag, or null when that tag's
 * samples are not a fixed, divisible number of bytes. A-law and mu-law are one
 * byte whatever the file claims; PCM and float must carry a bit depth that
 * fits. Any other tag (including a compressed one) has no fixed frame.
 */
function wavSampleBytes(tag, bits) {
    if (tag === 6 || tag === 7) return bits === 8 ? 1 : null;            // A-law, mu-law
    if (tag === 1) return bits && bits % 8 === 0 && bits <= 32 ? bits / 8 : null; // PCM
    if (tag === 3) return bits === 32 || bits === 64 ? bits / 8 : null;  // IEEE float
    return null;
}

/**
 * WAV: the bytes after the data chunk's header over (sample rate x frame size).
 * The byte-rate field, the block-align field and the data chunk's declared size
 * are not read: everything up to the end of the file is counted as audio, and
 * the frame is channels x the sample size the format tag fixes. A second format
 * chunk, a format chunk too short to hold its fields, a sample size that does
 * not fit the tag, or an extensible format without a fixed-frame SubFormat is
 * refused.
 */
export function wavSeconds(b, totalBytes) {
    if (!(b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE'))) return null;
    let bytesPerSecond = null;
    let seenFmt = false;
    for (let i = 12; i + 8 <= b.length;) {
        const size = le32(b, i + 4);
        if (ascii(b, i, 'fmt ')) {
            if (seenFmt) return null;                            // a reader may honour a different chunk
            seenFmt = true;
            if (size < 16 || i + 24 > b.length) return null;
            const tag = le16(b, i + 8);
            const channels = le16(b, i + 10);
            const rate = le32(b, i + 12);
            const bits = le16(b, i + 22);
            let formatTag = tag;
            if (tag === 0xfffe) {                                // extensible: the SubFormat is the real tag
                if (size < 40 || i + 34 > b.length) return null;
                formatTag = le16(b, i + 32);                     // first two bytes of the SubFormat GUID
            }
            const sampleBytes = wavSampleBytes(formatTag, bits);
            if (!channels || !rate || !sampleBytes) return null;
            bytesPerSecond = rate * channels * sampleBytes;
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

// A trailing ID3v1 tag, a few bytes of padding or a short resync are tolerated;
// a file that is mostly not frames is something a bitrate-estimating reader
// would time differently, so it is refused.
const MP3_MAX_NON_FRAME_BYTES = 1024;

/**
 * The bytes an ID3v2 header at the start of `b` occupies, 0 when there is none,
 * or -1 when an `ID3` magic is followed by bytes that are not a well-formed
 * header: a reader that rejects the header decodes those bytes as audio, so a
 * malformed one is refused rather than skipped.
 */
function id3Skip(b) {
    if (b.length < 10 || !ascii(b, 0, 'ID3')) return 0;
    if (b[3] === 0xff || b[4] === 0xff) return -1;                 // the version bytes of a real tag are not 0xFF
    if ((b[6] | b[7] | b[8] | b[9]) & 0x80) return -1;             // each size byte is synch-safe (high bit clear)
    return 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
}

const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out; };

/**
 * Count MPEG Layer III frames across a file handed in piece by piece, so the
 * whole object is never held: only one piece and a frame-sized carry are live
 * at a time. `push` returns false once the length is known to be unmeasurable
 * (a Layer I/II or free-format frame); `end` returns the seconds, or null when
 * the file could not be measured one way.
 */
export function mp3FrameCounter() {
    let carry = new Uint8Array(0);
    let resolvedHeader = false;
    let skipRemaining = 0;
    let seconds = 0;
    let nonFrame = 0;
    let failed = false;

    const fail = () => { failed = true; carry = new Uint8Array(0); return false; };

    function run(buf, final) {
        let i = 0;
        if (!resolvedHeader) {
            if (!final && buf.length < 10) { carry = buf.slice(); return true; } // 10 bytes decide an ID3 header
            const skip = id3Skip(buf);
            if (skip < 0) return fail();
            resolvedHeader = true;
            skipRemaining = skip;
        }
        if (skipRemaining > 0) {
            const drop = Math.min(skipRemaining, buf.length);
            i += drop; skipRemaining -= drop;
            if (skipRemaining > 0) { carry = new Uint8Array(0); return true; }
        }
        while (i + 4 <= buf.length) {
            const frame = mpegFrame(buf, i);
            if (frame === 'unsupported') return fail();
            if (!frame) { i += 1; nonFrame += 1; continue; }
            if (!final && i + frame.bytes > buf.length) break;      // wait for the rest of this frame
            seconds += frame.seconds;
            i += frame.bytes;
        }
        carry = final ? new Uint8Array(0) : buf.slice(i);
        if (final) nonFrame += Math.max(0, buf.length - i);
        return true;
    }

    return {
        push(piece) {
            if (failed) return false;
            return run(carry.length ? concat(carry, piece) : piece, false);
        },
        end() {
            if (!failed) run(carry, true);
            if (failed || seconds <= 0 || nonFrame > MP3_MAX_NON_FRAME_BYTES) return null;
            return seconds;
        },
    };
}

/**
 * MP3: every Layer III frame in the file, counted. Needs the whole file: a
 * partial read is null. A Xing or VBRI frame count is not read. An ID3v2 header
 * is stepped over only when it is well formed, and a file that is mostly not
 * frames is refused.
 */
export function mp3Seconds(b, totalBytes) {
    if (b.length < totalBytes) return null;
    const counter = mp3FrameCounter();
    counter.push(b.subarray(0, totalBytes));
    return counter.end();
}

const MOOV_MAX_BYTES = 4 * 1024 * 1024;
const TOP_LEVEL_MAX_BOXES = 64;
// Boxes that hold other boxes. A leaf box's bytes are its own fields, not child
// boxes, so a deep scan only ever descends into these.
const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'mvex']);

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

/** How many boxes of `type` sit anywhere inside [start, end). -1 when a box runs past its parent. */
function countDeep(b, start, end, type) {
    const kids = children(b, start, end);
    if (kids === null) return -1;
    let count = 0;
    for (const k of kids) {
        if (k.type === type) count += 1;
        if (MP4_CONTAINERS.has(k.type)) {
            const inner = countDeep(b, k.start, k.end, type);
            if (inner < 0) return -1;
            count += inner;
        }
    }
    return count;
}

/** A length field and the timescale before it: 32-bit in version 0 boxes, 64-bit in version 1. */
function timed(b, box, v0Scale, v1Scale) {
    const v1 = b[box.start] === 1;
    const at = box.start + (v1 ? v1Scale : v0Scale);
    return at + (v1 ? 12 : 8) > box.end ? null : { scale: u32(b, at), duration: v1 ? u64(b, at + 4) : u32(b, at + 4) };
}

/**
 * True when `elst` is a single edit a reader cannot time two ways: one entry,
 * at normal rate, with a real (non-empty) media start, presenting no more than
 * the media actually holds (`played` seconds at `movieScale`). Anything else —
 * several edits replaying the media, a speed other than 1, an empty edit, a
 * version-1 list, a list cut short, or a segment longer than the media — is not
 * one we model, so the track is refused. MP4 integers are big-endian.
 */
function plainEditList(b, elst, movieScale, played) {
    if (b[elst.start] === 1) return false;                          // a 64-bit edit list is not modelled
    if (elst.start + 8 > elst.end) return false;
    if (u32(b, elst.start + 4) !== 1) return false;                 // exactly one edit
    const entry = elst.start + 8;
    if (entry + 12 > elst.end) return false;
    if (i32(b, entry + 4) < 0) return false;                        // an empty edit (media time -1)
    if (be16(b, entry + 8) !== 1 || be16(b, entry + 10) !== 0) return false; // rate 1.0 in 16.16
    return u32(b, entry) / movieScale <= played + 0.5;              // presents no more than the media holds
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
        // A track a reader could time two ways is refused: a second sample table
        // (a reader may sum a different one), a sample table with no media header
        // (the ticks have no timescale), or an edit list that is not one plain edit.
        const stts = countDeep(moov, trak.start, trak.end, 'stts');
        const mdhd = countDeep(moov, trak.start, trak.end, 'mdhd');
        const elstCount = countDeep(moov, trak.start, trak.end, 'elst');
        if (stts < 0 || mdhd < 0 || elstCount < 0 || stts > 1 || elstCount > 1) return null;
        if (stts === 1 && mdhd !== 1) return null;
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
        const played = sampleTableSeconds(moov, inTrak, stts);
        if (played === null) return null;
        if (elstCount === 1) {
            const edts = inTrak.find((x) => x.type === 'edts');
            const list = edts && (children(moov, edts.start, edts.end) || []).find((x) => x.type === 'elst');
            if (!list || !plainEditList(moov, list, movie.scale, played)) return null;
        }
        seconds = Math.max(seconds, played);
    }
    return seconds > 0 ? { seconds, width, height } : null;
}

/**
 * What a decoder plays from one track: its time-to-sample table summed. 0 for a
 * track with no table; null when unreadable. `sttsCount` is how many `stts`
 * boxes the track holds anywhere: if it holds one but it is not on the canonical
 * media -> minf -> stbl path, a lenient reader finds a table this one does not,
 * so the track is refused rather than measured from its headers.
 */
function sampleTableSeconds(moov, inTrak, sttsCount) {
    const inside = (box, type) => {
        const kids = box && children(moov, box.start, box.end);
        return kids === null ? null : kids && kids.find((x) => x.type === type);
    };
    const mdia = inTrak.find((x) => x.type === 'mdia');
    if (!mdia) return sttsCount > 0 ? null : 0;
    const mdhd = inside(mdia, 'mdhd');
    const stts = inside(inside(inside(mdia, 'minf'), 'stbl'), 'stts');
    if (mdhd === null || stts === null) return null;
    if (!stts) return sttsCount > 0 ? null : 0;          // a sample table that is not where it belongs
    if (!mdhd) return null;
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
