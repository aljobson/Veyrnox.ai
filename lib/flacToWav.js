// FLAC -> PCM WAV, pure JavaScript. The Worker cannot compile WebAssembly from
// bytes at run time, so a WASM decoder is not an option. Music stores ACE-Step 1.5
// output as WAV so every editing feature and local render can read it
// (docs/product/music-source-formats-plan-2026-11-14.md, option A).
//
// Lossless: the WAV keeps the stream's sample rate, channels and bit depth.
// Every frame header CRC-8 and frame CRC-16 is checked; any malformed input
// throws, and the caller keeps the original file.

export const FLAC_TO_WAV_MAX_OUTPUT_BYTES = 25 * 1024 * 1024;

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    CRC8[i] = c;
    let d = i << 8;
    for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
    CRC16[i] = d;
}
const POW2 = Array.from({ length: 64 }, (_, i) => 2 ** i);

class Bits {
    constructor(bytes, pos) { this.b = bytes; this.pos = pos * 8; }
    bit() {
        const p = this.pos++;
        const byte = this.b[p >>> 3];
        if (byte === undefined) throw new Error('flac: truncated');
        return (byte >>> (7 - (p & 7))) & 1;
    }
    read(n) {
        let v = 0;
        for (let i = 0; i < n; i++) v = v * 2 + this.bit();
        return v;
    }
    signed(n) {
        if (n === 0) return 0;
        const v = this.read(n);
        return v >= POW2[n - 1] ? v - POW2[n] : v;
    }
    unary() {
        let n = 0;
        // Skip whole zero bytes when aligned.
        while ((this.pos & 7) === 0 && this.b[this.pos >>> 3] === 0) { n += 8; this.pos += 8; if (n > 1 << 20) throw new Error('flac: bad unary'); }
        while (this.bit() === 0) { n++; if (n > 1 << 20) throw new Error('flac: bad unary'); }
        return n;
    }
    align() { this.pos = (this.pos + 7) & ~7; }
    get byte() { return this.pos >>> 3; }
}

function readStreamInfo(bytes) {
    let pos = 0;
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) { // ID3v2
        const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
        pos = 10 + size + ((bytes[5] & 0x10) ? 10 : 0);
    }
    if (bytes[pos] !== 0x66 || bytes[pos + 1] !== 0x4c || bytes[pos + 2] !== 0x61 || bytes[pos + 3] !== 0x43) throw new Error('flac: no marker');
    pos += 4;
    let info = null;
    for (;;) {
        if (pos + 4 > bytes.length) throw new Error('flac: truncated metadata');
        const head = bytes[pos];
        const len = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
        if ((head & 0x7f) === 0) {
            if (len < 34) throw new Error('flac: bad streaminfo');
            const r = new Bits(bytes, pos + 4);
            r.read(16); r.read(16); r.read(24); r.read(24);
            const sampleRate = r.read(20);
            const channels = r.read(3) + 1;
            const bps = r.read(5) + 1;
            const total = r.read(36);
            info = { sampleRate, channels, bps, total };
        }
        pos += 4 + len;
        if (head & 0x80) break;
    }
    if (!info) throw new Error('flac: no streaminfo');
    return { info, framesAt: pos };
}

function residual(r, out, blockSize, order) {
    const method = r.read(2);
    if (method > 1) throw new Error('flac: bad residual method');
    const paramBits = method === 0 ? 4 : 5;
    const escape = method === 0 ? 15 : 31;
    const partOrder = r.read(4);
    const parts = 1 << partOrder;
    const per = blockSize >>> partOrder;
    if (per < order || (per << partOrder) !== blockSize) throw new Error('flac: bad partition');
    let i = order;
    for (let p = 0; p < parts; p++) {
        const n = p === 0 ? per - order : per;
        const k = r.read(paramBits);
        if (k === escape) {
            const raw = r.read(5);
            for (let j = 0; j < n; j++) out[i++] = r.signed(raw);
        } else {
            const scale = POW2[k];
            for (let j = 0; j < n; j++) {
                const u = r.unary() * scale + r.read(k);
                out[i++] = u % 2 === 0 ? u / 2 : -(u + 1) / 2;
            }
        }
    }
}

const FIXED = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]];

function subframe(r, blockSize, bps) {
    if (r.bit() !== 0) throw new Error('flac: bad subframe pad');
    const type = r.read(6);
    let wasted = 0;
    if (r.bit()) wasted = r.unary() + 1;
    const bits = bps - wasted;
    if (bits < 1) throw new Error('flac: bad wasted bits');
    const s = new Float64Array(blockSize);
    if (type === 0) {
        s.fill(r.signed(bits));
    } else if (type === 1) {
        for (let i = 0; i < blockSize; i++) s[i] = r.signed(bits);
    } else if (type >= 8 && type <= 12) {
        const order = type - 8;
        for (let i = 0; i < order; i++) s[i] = r.signed(bits);
        residual(r, s, blockSize, order);
        const c = FIXED[order];
        for (let i = order; i < blockSize; i++) {
            let sum = 0;
            for (let j = 0; j < order; j++) sum += c[j] * s[i - 1 - j];
            s[i] += sum;
        }
    } else if (type >= 32) {
        const order = type - 31;
        if (order > blockSize) throw new Error('flac: bad lpc order');
        for (let i = 0; i < order; i++) s[i] = r.signed(bits);
        const precision = r.read(4) + 1;
        if (precision === 16) throw new Error('flac: bad lpc precision');
        const shift = r.signed(5);
        if (shift < 0) throw new Error('flac: bad lpc shift');
        const coef = new Array(order);
        for (let j = 0; j < order; j++) coef[j] = r.signed(precision);
        residual(r, s, blockSize, order);
        const div = POW2[shift];
        for (let i = order; i < blockSize; i++) {
            let sum = 0;
            for (let j = 0; j < order; j++) sum += coef[j] * s[i - 1 - j];
            s[i] += Math.floor(sum / div);
        }
    } else {
        throw new Error('flac: reserved subframe type');
    }
    if (wasted) { const m = POW2[wasted]; for (let i = 0; i < blockSize; i++) s[i] *= m; }
    return s;
}

const BLOCK = [0, 192, 576, 1152, 2304, 4608, -1, -2, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
const RATE = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000, -1, -2, -3, 0];
const DEPTH = [0, 8, 12, 0, 16, 20, 24, 32];

function crc8(bytes, from, to) { let c = 0; for (let i = from; i < to; i++) c = CRC8[c ^ bytes[i]]; return c; }
function crc16(bytes, from, to) { let c = 0; for (let i = from; i < to; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >>> 8) ^ bytes[i]]; return c; }

function frame(bytes, at, info) {
    const r = new Bits(bytes, at);
    if (r.read(14) !== 0x3ffe) throw new Error('flac: lost sync');
    r.read(2);
    const bsCode = r.read(4);
    const srCode = r.read(4);
    const chCode = r.read(4);
    const depthCode = r.read(3);
    r.read(1);
    // UTF-8 coded frame or sample number.
    let lead = r.read(8);
    let extra = 0;
    while (lead & 0x80) { extra++; lead = (lead << 1) & 0xff; }
    if (extra === 1 || extra > 7) throw new Error('flac: bad frame number');
    for (let i = 1; i < extra; i++) r.read(8);
    let blockSize = BLOCK[bsCode];
    if (blockSize === -1) blockSize = r.read(8) + 1;
    else if (blockSize === -2) blockSize = r.read(16) + 1;
    if (!blockSize) throw new Error('flac: reserved block size');
    const rate = RATE[srCode];
    if (rate === -1) r.read(8); else if (rate === -2 || rate === -3) r.read(16);
    if (srCode === 15) throw new Error('flac: bad sample rate');
    if (crc8(bytes, at, r.byte) !== r.read(8)) throw new Error('flac: header crc');
    const bps = depthCode === 0 ? info.bps : DEPTH[depthCode];
    if (!bps || bps !== info.bps) throw new Error('flac: depth mismatch');
    const channels = chCode < 8 ? chCode + 1 : 2;
    if (chCode > 10 || channels !== info.channels) throw new Error('flac: channel mismatch');
    const ch = [];
    for (let c = 0; c < channels; c++) {
        const side = (chCode === 8 && c === 1) || (chCode === 9 && c === 0) || (chCode === 10 && c === 1);
        ch.push(subframe(r, blockSize, bps + (side ? 1 : 0)));
    }
    const [a, b] = ch;
    if (chCode === 8) for (let i = 0; i < blockSize; i++) b[i] = a[i] - b[i];
    else if (chCode === 9) for (let i = 0; i < blockSize; i++) a[i] += b[i];
    else if (chCode === 10) {
        for (let i = 0; i < blockSize; i++) {
            const side = b[i];
            const mid = a[i] * 2 + (side % 2 !== 0 ? 1 : 0);
            a[i] = (mid + side) / 2;
            b[i] = (mid - side) / 2;
        }
    }
    r.align();
    const end = r.byte;
    if (crc16(bytes, at, end) !== r.read(16)) throw new Error('flac: frame crc');
    return { ch, blockSize, next: end + 2 };
}

/** True when the bytes open like a FLAC stream (optionally behind an ID3v2 tag). */
export function looksLikeFlac(bytes) {
    try { readStreamInfo(bytes); return true; } catch { return false; }
}

/** Decode a whole FLAC file to a RIFF WAVE file with the same format. */
export function flacToWav(bytes, { maxOutputBytes = FLAC_TO_WAV_MAX_OUTPUT_BYTES } = {}) {
    const { info, framesAt } = readStreamInfo(bytes);
    const { sampleRate, channels, bps } = info;
    if (![8, 16, 24].includes(bps)) throw new Error('flac: unsupported bit depth');
    if (!sampleRate) throw new Error('flac: no sample rate');
    const sampleBytes = bps / 8;
    const blockAlign = channels * sampleBytes;
    // Decoded samples go straight into the output, one frame at a time, so memory
    // stays near the size of the WAV itself (a Worker isolate has 128 MB).
    if (info.total * blockAlign > maxOutputBytes) throw new Error('flac: output too large');
    let out = new Uint8Array(44 + (info.total ? info.total * blockAlign : 1 << 20));
    let total = 0;
    let at = framesAt;
    while (at + 2 <= bytes.length) {
        const f = frame(bytes, at, info);
        const n = info.total ? Math.min(f.blockSize, info.total - total) : f.blockSize;
        if ((total + n) * blockAlign > maxOutputBytes) throw new Error('flac: output too large');
        const need = 44 + (total + n) * blockAlign;
        if (need > out.length) {
            const grown = new Uint8Array(Math.min(Math.max(need, out.length * 2), 44 + maxOutputBytes));
            grown.set(out);
            out = grown;
        }
        let o = 44 + total * blockAlign;
        for (let i = 0; i < n; i++) {
            for (let c = 0; c < channels; c++) {
                const s = f.ch[c][i];
                if (bps === 8) out[o] = s + 128;
                else if (bps === 16) { const u = s < 0 ? s + 0x10000 : s; out[o] = u & 0xff; out[o + 1] = u >>> 8; }
                else { const u = s < 0 ? s + 0x1000000 : s; out[o] = u & 0xff; out[o + 1] = (u >>> 8) & 0xff; out[o + 2] = (u >>> 16) & 0xff; }
                o += sampleBytes;
            }
        }
        total += n;
        at = f.next;
    }
    if (info.total && total < info.total) throw new Error('flac: missing samples');
    const dataBytes = total * blockAlign;
    if (out.length !== 44 + dataBytes) out = out.slice(0, 44 + dataBytes);
    const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const tag = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE');
    tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * blockAlign, true);
    v.setUint16(32, blockAlign, true); v.setUint16(34, bps, true);
    tag(36, 'data'); v.setUint32(40, dataBytes, true);
    return { wav: out, sampleRate, channels, bitsPerSample: bps, samples: total };
}
