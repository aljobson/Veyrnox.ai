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

test('returns null rather than guessing', () => {
    assert.equal(imageDimensions(jpeg(640, 480, 60000).subarray(0, 1000)), null, 'SOF beyond the bytes read');
    assert.equal(imageDimensions(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0])), null, 'an MP4');
    assert.equal(imageDimensions(png(0, 10)), null);
});
