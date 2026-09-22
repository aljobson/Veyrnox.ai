import test from 'node:test';
import assert from 'node:assert/strict';
import { wavSeconds, mp3Seconds, mp4Seconds } from '../lib/mediaLength.js';
import { sniffType } from '../lib/uploadSource.js';

function wav(seconds, rate = 16000) {
    const data = Buffer.alloc(rate * 2 * seconds);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
    h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write('data', 36); h.writeUInt32LE(data.length, 40);
    return new Uint8Array(Buffer.concat([h, data]));
}

// One MPEG-1 Layer III frame header: 128 kbps, 44.1 kHz, stereo.
const MP3_FRAME = [0xff, 0xfb, 0x90, 0x00];

test('WAV length is the data size over the byte rate', () => {
    const w = wav(7);
    assert.equal(wavSeconds(w, w.length), 7);
    assert.equal(sniffType(w), 'audio/wav');
});

test('MP3: constant bitrate from the first frame, past an ID3 tag', () => {
    const id3 = [0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)];
    const b = new Uint8Array([...id3, ...MP3_FRAME, ...new Array(100).fill(0)]);
    // 160,000 bytes of audio at 128 kbps = 10 s.
    assert.equal(mp3Seconds(b, id3.length + 160000), 10);
    assert.equal(sniffType(b), 'audio/mpeg');
});

test('MP3: a Xing frame count wins over the bitrate estimate (VBR)', () => {
    const frame = new Array(200).fill(0);
    frame.splice(0, 4, ...MP3_FRAME);
    const x = 4 + 32; // stereo MPEG-1
    'Xing'.split('').forEach((c, i) => { frame[x + i] = c.charCodeAt(0); });
    frame[x + 7] = 1; // frames field present
    const frames = 383; // 383 * 1152 / 44100 = 10.005 s
    frame[x + 8] = (frames >> 24) & 255; frame[x + 9] = (frames >> 16) & 255; frame[x + 10] = (frames >> 8) & 255; frame[x + 11] = frames & 255;
    assert.equal(mp3Seconds(new Uint8Array(frame), 999999).toFixed(3), '10.005');
});

test('unreadable lengths are null, never a guess', () => {
    assert.equal(wavSeconds(new Uint8Array(12), 12), null);
    assert.equal(mp3Seconds(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0x7f, 0x7f, 0x7f]), 5_000_000), null, 'cover art bigger than the read');
});

function box(type, payload) {
    const b = Buffer.alloc(8 + payload.length);
    b.writeUInt32BE(b.length, 0); b.write(type, 4); payload.copy(b, 8);
    return b;
}

test('MP4 length from mvhd, with moov after mdat', async () => {
    const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(12500, 16); // v0: scale 1000, 12.5 s
    const file = Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.alloc(50000)), box('moov', box('mvhd', mvhd))]);
    const reads = [];
    const readRange = async (s, e) => { reads.push([s, e]); return new Uint8Array(file.subarray(s, e + 1)); };
    assert.equal(await mp4Seconds(readRange, file.length), 12.5);
    assert.ok(reads.every(([s, e]) => e - s < 300 * 1024), 'ranged reads only');
});
