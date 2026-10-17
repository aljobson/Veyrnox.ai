import { sniffType } from './uploadSource.js';

// Provider output only. This deliberately does not change the user-upload policy.
export const PROVIDER_SNIFF_BYTES = 128 * 1024;
const ascii = (bytes, offset, text) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

/** ID3v2 size excludes the ten-byte header and optional v2.4 footer. */
function audioOffset(bytes) {
    if (bytes.length < 10 || ![2, 3, 4].includes(bytes[3]) || bytes[4] === 255) return null;
    const allowedFlags = { 2: 0xc0, 3: 0xe0, 4: 0xf0 }[bytes[3]];
    if (bytes[5] & ~allowedFlags || bytes.subarray(6, 10).some((byte) => byte & 128)) return null;
    const size = bytes.subarray(6, 10).reduce((value, byte) => value * 128 + byte, 0);
    const footer = bytes[3] === 4 && (bytes[5] & 0x10) ? 10 : 0;
    const offset = 10 + size + footer;
    if (offset + 4 > bytes.length) return null;
    if (footer && (!ascii(bytes, offset - 10, '3DI')
        || !bytes.subarray(3, 10).every((byte, index) => byte === bytes[offset - 7 + index]))) return null;
    return offset;
}

/** A bounded signature check, not a decoder: STREAMINFO plus the first frame. RFC 9639 §§8–9. */
function isFlac(bytes, offset) {
    if (!ascii(bytes, offset, 'fLaC') || offset + 46 > bytes.length) return false;
    const info = offset + 8;
    if ((bytes[offset + 4] & 127) !== 0 || bytes[offset + 5] !== 0 || bytes[offset + 6] !== 0 || bytes[offset + 7] !== 34) return false;
    const minBlock = bytes[info] * 256 + bytes[info + 1], maxBlock = bytes[info + 2] * 256 + bytes[info + 3];
    const sampleRate = bytes[info + 10] * 4096 + bytes[info + 11] * 16 + (bytes[info + 12] >>> 4);
    const bits = ((bytes[info + 12] & 1) << 4 | bytes[info + 13] >>> 4) + 1;
    if (minBlock < 16 || maxBlock < minBlock || sampleRate === 0 || bits < 4) return false;
    let cursor = offset + 4;
    for (;;) {
        if (cursor + 4 > bytes.length) return false;
        const type = bytes[cursor] & 127, last = !!(bytes[cursor] & 128);
        if (type > 6 || (cursor !== offset + 4 && type === 0)) return false;
        const size = bytes[cursor + 1] * 65536 + bytes[cursor + 2] * 256 + bytes[cursor + 3];
        cursor += 4 + size;
        if (cursor + 4 > bytes.length) return false;
        if (last) break;
    }
    return bytes[cursor] === 255 && (bytes[cursor + 1] & 0xfe) === 0xf8
        && (bytes[cursor + 2] >>> 4) !== 0 && (bytes[cursor + 2] & 15) !== 15
        && (bytes[cursor + 3] >>> 4) <= 10 && (bytes[cursor + 3] & 1) === 0
        && ((bytes[cursor + 3] >>> 1) & 7) !== 3;
}

/** MPEG Layer III: reject reserved/free headers and require the complete first frame. */
function isMp3(bytes, offset) {
    if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 0xe0) !== 0xe0) return false;
    const version = (bytes[offset + 1] >>> 3) & 3, layer = (bytes[offset + 1] >>> 1) & 3;
    const bitrateIndex = bytes[offset + 2] >>> 4, sampleIndex = (bytes[offset + 2] >>> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3 || (bytes[offset + 3] & 3) === 2) return false;
    const rates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const sampleRate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const length = Math.floor((version === 3 ? 144000 : 72000) * rates[bitrateIndex] / sampleRate) + ((bytes[offset + 2] >>> 1) & 1);
    return offset + length <= bytes.length;
}

/** Never trust a provider filename/header, or mistake an ID3 metadata tag for MPEG audio. */
export function sniffProviderOutputType(input) {
    const bytes = (input instanceof Uint8Array ? input : new Uint8Array(input || [])).subarray(0, PROVIDER_SNIFF_BYTES);
    const tagged = ascii(bytes, 0, 'ID3');
    const offset = tagged ? audioOffset(bytes) : 0;
    if (offset === null) return null;
    if (ascii(bytes, offset, 'fLaC')) return isFlac(bytes, offset) ? 'audio/flac' : null;
    if (tagged || bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0) return isMp3(bytes, offset) ? 'audio/mpeg' : null;
    return sniffType(bytes);
}
