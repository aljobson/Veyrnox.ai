import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { imageDimensions } from '../lib/uploadSource.js';

function png(w, h) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(1)))]));
}

// JPEG: SOI, an APP1 segment of `pad` bytes (EXIF sits here), then SOF0.
function jpeg(w, h, pad = 20) {
    const app1 = [0xff, 0xe1, (pad + 2) >> 8, (pad + 2) & 0xff, ...new Array(pad).fill(0)];
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9]);
}

function webpVp8x(w, h) {
    const b = Buffer.alloc(30);
    b.write('RIFF', 0); b.write('WEBP', 8); b.write('VP8X', 12);
    b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
    return new Uint8Array(b);
}

test('reads the pixel size from PNG, JPEG and WebP headers', () => {
    assert.deepEqual(imageDimensions(png(2752, 1536)), { width: 2752, height: 1536 });
    assert.deepEqual(imageDimensions(jpeg(4000, 3000)), { width: 4000, height: 3000 });
    assert.deepEqual(imageDimensions(jpeg(640, 480, 60000)), { width: 640, height: 480 }, 'past a large EXIF segment');
    assert.deepEqual(imageDimensions(webpVp8x(1920, 1080)), { width: 1920, height: 1080 });
});

// A JPEG frame header (SOF0) for a w x h, three-component image.
const sof = (w, h) => [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
const segment = (marker, bytes) => [0xff, marker, (bytes + 2) >> 8, (bytes + 2) & 0xff, ...new Array(bytes).fill(0)];

test('JPEG: a marker with no length field before the frame header is refused', () => {
    // TEM (0x01) and RST0-7 (0xD0-0xD7) carry no length field, so nothing after
    // one says where the next marker is. No camera or editor writes one here.
    for (const marker of [0x01, 0xd0, 0xd7]) {
        const file = new Uint8Array(70_000);
        file.set([0xff, 0xd8, 0xff, marker, ...sof(10_000, 10_000), 0xff, 0xfe, 0xff, 0xff]);
        file.set(sof(100, 100), 2 + 2 + 0xffc0);
        assert.equal(imageDimensions(file), null, `marker 0x${marker.toString(16)}`);
    }
});

test('JPEG: length-bearing segments before the frame header are still skipped', () => {
    const before = (...segments) => imageDimensions(new Uint8Array([0xff, 0xd8, ...segments.flat(), ...sof(640, 480), 0xff, 0xd9]));
    const usual = [segment(0xe0, 14), segment(0xe1, 300), segment(0xfe, 20), segment(0xdb, 65), segment(0xc4, 30), segment(0xdd, 2)];
    assert.deepEqual(before(...usual), { width: 640, height: 480 }, 'APPn, COM, DQT, DHT and DRI');
    assert.deepEqual(before([0xff, 0xff, 0xff], segment(0xe0, 14)), { width: 640, height: 480 }, 'fill bytes before a marker');
});

test('JPEG: a standalone marker or a sub-2 length before the frame header is refused', () => {
    const before = (...bytes) => imageDimensions(new Uint8Array([0xff, 0xd8, ...bytes, ...sof(640, 480), 0xff, 0xd9]));
    assert.equal(before(0xff, 0xd9), null, 'end-of-image');
    assert.equal(before(0xff, 0xd0), null, 'a restart marker');
    assert.equal(before(0xff, 0x00), null, 'a stuffed zero byte');
    assert.equal(before(0xff, 0xe0, 0x00, 0x01, 0x00), null, 'a segment shorter than its length field');
});

test('returns null rather than guessing', () => {
    assert.equal(imageDimensions(jpeg(640, 480, 60000).subarray(0, 1000)), null, 'SOF beyond the bytes read');
    assert.equal(imageDimensions(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0])), null, 'an MP4');
    assert.equal(imageDimensions(png(0, 10)), null);
});
