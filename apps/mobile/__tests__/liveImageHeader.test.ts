import { jpegSize } from '../src/lib/liveEdit/imageHeader';
const b64 = (bytes: number[], pad = 200) => btoa(String.fromCharCode(...bytes) + 'A'.repeat(pad));
const be = (n: number) => [(n >> 8) & 255, n & 255];
const jpeg = (w: number, h: number, withApp = true) => b64([0xff, 0xd8, ...(withApp ? [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0] : []), 0xff, 0xc0, 0x00, 0x11, 8, ...be(h), ...be(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
test('reads the JPEG size from the frame header, past other segments', () => {
    expect(jpegSize(jpeg(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(jpegSize(jpeg(4000, 3000, false))).toEqual({ width: 4000, height: 3000 });
});
test('rejects what is not a JPEG, or has no frame header', () => {
    expect(jpegSize(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull(); expect(jpegSize('')).toBeNull();
    expect(jpegSize(b64([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4]))).toBeNull(); // scan before any frame header
    expect(jpegSize(b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]))).toBeNull(); // impossible segment length
});
