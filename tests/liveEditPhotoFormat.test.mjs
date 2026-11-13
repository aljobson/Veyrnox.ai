import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PHOTO_ACCEPT, sniffPhotoType, validatePhoto } from '../app/veyrnox/_lib/liveEdit/photoFormat.js';
import { decodePhoto } from '../app/veyrnox/_lib/liveEdit/engine.js';
function ftyp(major, ...compatible) {
    const bytes = Buffer.alloc(16 + compatible.length * 4);
    bytes.writeUInt32BE(bytes.length); bytes.write('ftyp', 4); bytes.write(major, 8);
    compatible.forEach((brand, i) => bytes.write(brand, 16 + i * 4)); return bytes;
}
const file = (bytes, type = '') => new Blob([bytes], { type });
test('iPhone major and compatible HEIC/HEIF brands work without a picker MIME', async () => {
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']) {
        assert.match(await sniffPhotoType(file(ftyp(brand))), /^image\/hei[cf]$/);
        assert.match(await sniffPhotoType(file(ftyp('iso8', brand))), /^image\/hei[cf]$/);
    }
    assert.equal(await sniffPhotoType(file(ftyp('mif1', 'heic'), 'image/heif')), 'image/heic');
});
test('Android AVIF including avis and compatible AVIF wins over generic HEIF brands', async () => {
    for (const brand of ['avif', 'avis']) {
        assert.equal(await sniffPhotoType(file(ftyp(brand))), 'image/avif');
        assert.equal(await sniffPhotoType(file(ftyp('mif1', brand), 'application/octet-stream')), 'image/avif');
    }
});
test('raster signatures win over empty and octet-stream MIME; contradictions fail', async () => {
    const cases = [[Buffer.from([255, 216, 255]), 'image/jpeg'], [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'], [Buffer.from('GIF87a'), 'image/gif'], [Buffer.from('GIF89a'), 'image/gif'], [Buffer.from('RIFF0000WEBP'), 'image/webp'], [Buffer.from('BM'), 'image/bmp']];
    for (const [bytes, type] of cases) {
        for (const declared of ['', 'application/octet-stream', type]) assert.equal(await sniffPhotoType(file(bytes, declared)), type);
        await assert.rejects(sniffPhotoType(file(bytes, 'image/avif')), /invalid-photo/);
    }
    await assert.rejects(sniffPhotoType(file(cases[0][0], 'image/png')), /invalid-photo/);
    await assert.rejects(sniffPhotoType(file(ftyp('heic'), 'image/jpeg')), /invalid-photo/);
    assert.ok(PHOTO_ACCEPT.includes('.heic,.heif,.avif'));
});
test('truncated, RAW and oversized sources fail closed before decoding', async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from([255, 216]), Buffer.from('GIF89'), ftyp('heic').subarray(0, 15), Buffer.from('II*\0raw'), ftyp('mp42')]) await assert.rejects(sniffPhotoType(file(bytes)), /invalid-photo/);
    await assert.rejects(validatePhoto({ size: 50 * 1024 * 1024 + 1, slice() { throw Error('must not read'); } }), /photo-too-large/);
});
test('native decode failures have actionable HEIC/AVIF states; corrupt raster remains generic', async () => {
    const fail = async () => { throw Error('native codec unavailable'); };
    for (const brand of ['heic', 'mif1', 'heix']) await assert.rejects(decodePhoto(file(ftyp(brand)), undefined, fail), /heic-unsupported/);
    for (const brand of ['avif', 'avis']) await assert.rejects(decodePhoto(file(ftyp(brand)), undefined, fail), /avif-unsupported/);
    await assert.rejects(decodePhoto(file(Buffer.from([255, 216, 255])), undefined, fail), /photo-decode-failed/);
});
test('EXIF orientation 6 synthetic JPEG reaches the decoder with from-image and uses upright dimensions', async () => {
    // Entirely generated pixels. Sharp is a decoder double here, not a claim of browser qualification.
    const jpeg = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#db2418' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    assert.equal((await sharp(jpeg).metadata()).orientation, 6);
    const image = await decodePhoto(file(jpeg), undefined, async (blob, options) => {
        assert.equal(blob.type, 'image/jpeg');
        assert.equal(options.imageOrientation, 'from-image'); assert.equal(options.premultiplyAlpha, 'none');
        const { info } = await sharp(Buffer.from(await blob.arrayBuffer())).rotate().raw().toBuffer({ resolveWithObject: true });
        return { width: info.width, height: info.height, close() {} };
    });
    assert.deepEqual([image.width, image.height], [16, 32]);
});
// Builds an 'ftyp' box with a 64-bit largesize header: size=1, 'ftyp', largesize(8), major, minor, compatible...
function largeFtyp(major, ...compatible) {
    const bytes = Buffer.alloc(24 + compatible.length * 4);
    bytes.writeUInt32BE(1); bytes.write('ftyp', 4); bytes.writeBigUInt64BE(BigInt(bytes.length), 8); bytes.write(major, 16);
    compatible.forEach((brand, i) => bytes.write(brand, 24 + i * 4)); return bytes;
}
test('long compatible-brand lists are read in full, whatever the declared type (review R3)', async () => {
    const many = ftyp('mif1', ...Array.from({ length: 1500 }, (_, i) => (i === 1400 ? 'avif' : 'xxxx')));
    assert.ok(many.length > 4096 && many.length <= 64 * 1024);
    // The avif brand lies past the first 4096 bytes: an empty, generic or correct declared type all resolve to AVIF.
    for (const declared of ['', 'application/octet-stream', 'image/avif']) assert.equal(await sniffPhotoType(file(many, declared)), 'image/avif');
    // A HEIC long list declared as image/heic stays HEIC; declaring it as AVIF is a real contradiction.
    const heic = ftyp('mif1', ...Array.from({ length: 1500 }, (_, i) => (i === 1400 ? 'heic' : 'xxxx')));
    assert.equal(await sniffPhotoType(file(heic, 'image/heic')), 'image/heic');
    await assert.rejects(sniffPhotoType(file(heic, 'image/avif')), /invalid-photo/);
});
test('64-bit largesize ftyp boxes are parsed from their real length and offsets (review R2)', async () => {
    assert.equal(await sniffPhotoType(file(largeFtyp('avif', 'mif1'))), 'image/avif');
    assert.equal(await sniffPhotoType(file(largeFtyp('heic'))), 'image/heic');
    // 'avif' bytes inside a FOLLOWING box (free) must never classify a non-image ftyp as an image.
    const real = largeFtyp('mp42'); real.writeBigUInt64BE(24n, 8);
    const free = Buffer.alloc(16); free.writeUInt32BE(16); free.write('free', 4); free.write('avif', 8);
    await assert.rejects(sniffPhotoType(file(Buffer.concat([real, free]))), /invalid-photo/);
    assert.equal(await sniffPhotoType(file(Buffer.concat([largeFtyp('mp42', 'isom'), free]))).catch(() => 'rejected'), 'rejected');
});
test('malformed ftyp lengths are refused: tiny, misaligned, zero, past the file, past the bound, bad largesize', async () => {
    const tiny = Buffer.alloc(16); tiny.writeUInt32BE(8); tiny.write('ftyp', 4);
    const odd = ftyp('heic'); odd.writeUInt32BE(18);
    const zero = ftyp('heic'); zero.writeUInt32BE(0);
    const pastFile = ftyp('heic'); pastFile.writeUInt32BE(4096);
    const pastBound = ftyp('heic'); pastBound.writeUInt32BE(70_000);
    const shortLarge = largeFtyp('heic'); shortLarge.writeBigUInt64BE(16n, 8);
    const hugeLarge = largeFtyp('heic'); hugeLarge.writeBigUInt64BE(2n ** 40n, 8);
    const misalignedLarge = largeFtyp('heic'); misalignedLarge.writeBigUInt64BE(26n, 8);
    for (const [name, bytes] of Object.entries({ tiny, odd, zero, pastFile, pastBound, shortLarge, hugeLarge, misalignedLarge })) {
        await assert.rejects(sniffPhotoType(file(bytes)), /invalid-photo/, name);
    }
});
