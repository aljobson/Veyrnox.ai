/**
 * Playing time of an uploaded audio or video file, read from its headers.
 *
 * Pure: bytes in, seconds out. Lip-sync models bill by output seconds, so the
 * gateway caps a source's length before the debit (ADR-0028). Every function
 * returns null when the length is not in the bytes it was given, and the
 * caller refuses the source: a guessed length is a guessed price.
 */

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const ascii = (b, i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

/** WAV: the data chunk's size over the fmt chunk's byte rate. */
export function wavSeconds(b, totalBytes) {
    if (!(b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE'))) return null;
    let byteRate = 0;
    for (let i = 12; i + 8 <= b.length;) {
        const size = le32(b, i + 4);
        if (ascii(b, i, 'fmt ') && i + 16 <= b.length) byteRate = le32(b, i + 16);
        if (ascii(b, i, 'data')) {
            if (!byteRate) return null;
            // A streamed WAV may leave the size unset; the file's end bounds it.
            const dataBytes = size && size !== 0xffffffff ? size : totalBytes - (i + 8);
            return dataBytes > 0 ? dataBytes / byteRate : null;
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

/**
 * MP3: the Xing/Info or VBRI frame count when present, else the constant
 * bitrate of the first frame over the audio bytes. An ID3v2 tag bigger than
 * the bytes read (cover art) leaves no frame to read: null.
 */
export function mp3Seconds(b, totalBytes) {
    let i = 0;
    if (b.length >= 10 && ascii(b, 0, 'ID3')) {
        i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
    }
    if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
    const version = (b[i + 1] >> 3) & 3;           // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const layer = (b[i + 1] >> 1) & 3;             // 1 = Layer III
    if (layer !== 1 || version === 1) return null;
    const kbps = BITRATES[version === 3 ? 1 : 2][b[i + 2] >> 4];
    const rate = (RATES[version] || [])[(b[i + 2] >> 2) & 3];
    if (!kbps || !rate) return null;
    const samplesPerFrame = version === 3 ? 1152 : 576;
    const mono = ((b[i + 3] >> 6) & 3) === 3;
    const xing = i + 4 + (version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17));
    if (xing + 12 <= b.length && (ascii(b, xing, 'Xing') || ascii(b, xing, 'Info')) && (b[xing + 7] & 1)) {
        return (u32(b, xing + 8) * samplesPerFrame) / rate;
    }
    if (i + 36 + 18 <= b.length && ascii(b, i + 36, 'VBRI')) {
        return (u32(b, i + 36 + 14) * samplesPerFrame) / rate;
    }
    return ((totalBytes - i) * 8) / (kbps * 1000);
}

/**
 * MP4: walk the top-level boxes to `moov`, then read `mvhd`. `readRange`
 * fetches [start, end] of the stored file, so a `moov` placed after the
 * media data costs one more ranged read, not a download.
 * @param {(start:number, end:number) => Promise<Uint8Array>} readRange
 */
export async function mp4Seconds(readRange, totalBytes) {
    let offset = 0;
    for (let hops = 0; hops < 8 && offset + 8 <= totalBytes; hops += 1) {
        const head = await readRange(offset, Math.min(offset + 16 * 1024, totalBytes) - 1);
        if (head.length < 8) return null;
        let size = u32(head, 0);
        const type = String.fromCharCode(head[4], head[5], head[6], head[7]);
        if (size === 1) size = u32(head, 8) * 2 ** 32 + u32(head, 12);
        if (size === 0) size = totalBytes - offset;
        if (size < 8) return null;
        if (type === 'moov') {
            // mvhd is moov's first child in practice; read enough to reach it.
            const moov = await readRange(offset, Math.min(offset + Math.min(size, 256 * 1024), totalBytes) - 1);
            for (let i = 8; i + 32 <= moov.length; i += 1) {
                if (!ascii(moov, i, 'mvhd')) continue;
                const v1 = moov[i + 4] === 1;
                const scale = u32(moov, i + (v1 ? 24 : 16));
                const duration = v1 ? u32(moov, i + 28) * 2 ** 32 + u32(moov, i + 32) : u32(moov, i + 20);
                return scale ? duration / scale : null;
            }
            return null;
        }
        offset += size;
    }
    return null;
}
