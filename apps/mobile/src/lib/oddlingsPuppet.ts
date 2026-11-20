// A cast portrait is about 80 KB; anything over this is refused before decoding.
export const PORTRAIT_BYTES_MAX = 5 * 1024 * 1024;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Hermes has btoa today, but jest and older engines may not; this is small enough to own.
export function toBase64(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
        out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
        out += i + 2 < bytes.length ? B64[c & 63] : '=';
    }
    return out;
}

// A WebP is "RIFF", four size bytes, then "WEBP". Anything else is never decoded.
export function isWebp(bytes: Uint8Array): boolean {
    const at = (i: number, text: string) => [...text].every((ch, k) => bytes[i + k] === ch.charCodeAt(0));
    return bytes.length > 12 && bytes.length <= PORTRAIT_BYTES_MAX && at(0, 'RIFF') && at(8, 'WEBP');
}
