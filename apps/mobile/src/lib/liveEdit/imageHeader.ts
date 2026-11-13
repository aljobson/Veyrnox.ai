// Reads the pixel size from an encoded image's header WITHOUT decoding it. A reply from the WebView is untrusted: a tiny file can
// claim any size, and a decoder would allocate for the real one. Callers compare this against what they asked for.
const bytes = (base64: string, count: number): Uint8Array | null => {
    try {
        const chars = Math.min(base64.length - (base64.length % 4), Math.ceil(count / 3) * 4);
        return Uint8Array.from(atob(base64.slice(0, chars)), c => c.charCodeAt(0));
    } catch { return null; }
};
export type Size = { width: number; height: number };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG: signature, then the IHDR chunk (length 13, "IHDR", width, height). */
export function pngSize(base64: string): Size | null {
    const b = bytes(base64, 24);
    if (!b || b.length < 24 || PNG_SIGNATURE.some((v, i) => b[i] !== v) || b[11] !== 13 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
    const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    return { width: u32(16), height: u32(20) };
}
/** JPEG: walk the marker segments until a start-of-frame (SOF) marker, which carries the height and width. */
export function jpegSize(base64: string): Size | null {
    const b = bytes(base64, 65536);
    if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    let i = 2;
    while (i + 3 < b.length) {
        if (b[i] !== 0xff) return null;
        while (b[i] === 0xff && i < b.length) i++; // fill bytes
        const marker = b[i++];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
        if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame header
        if (i + 1 >= b.length) return null;
        const length = (b[i] << 8) | b[i + 1];
        if (length < 2) return null;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            if (i + 6 >= b.length || length < 8) return null;
            return { height: (b[i + 3] << 8) | b[i + 4], width: (b[i + 5] << 8) | b[i + 6] };
        }
        i += length;
    }
    return null;
}
