import test from 'node:test';
import assert from 'node:assert/strict';
import { wavSeconds, mp3Seconds, mp4Seconds, mp4Info } from '../lib/mediaLength.js';
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

test('WAV length is its audio bytes over the sample rate and frame size', () => {
    const w = wav(7);
    assert.equal(wavSeconds(w, w.length), 7);
    assert.equal(sniffType(w), 'audio/wav');
});

test('WAV: a byte rate or a data size that understates the file is not believed', () => {
    const fast = Buffer.from(wav(7)); fast.writeUInt32LE(32000 * 1000, 28);          // byte rate x1000
    assert.equal(wavSeconds(new Uint8Array(fast), fast.length), 7);
    const short = Buffer.from(wav(7)); short.writeUInt32LE(1000, 40);                // "1,000 bytes of audio"
    assert.equal(wavSeconds(new Uint8Array(short), short.length), 7);
    const wide = Buffer.from(wav(7)); wide.writeUInt16LE(200, 32);                   // frame size 200 for 16-bit mono
    assert.equal(wavSeconds(new Uint8Array(wide), wide.length), 7, 'the smaller of the two frame sizes is used');
});

test('WAV: a compressed format has no fixed frame size, so its length is unknown', () => {
    const adpcm = Buffer.from(wav(7)); adpcm.writeUInt16LE(0x11, 20);
    assert.equal(wavSeconds(new Uint8Array(adpcm), adpcm.length), null);
});

// MPEG-1 Layer III frames at 44.1 kHz stereo: each a header and a silent payload of the frame's real size.
const MP3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
function mp3(frames, kbps = 128) {
    const size = Math.floor((144000 * kbps) / 44100);
    const out = Buffer.alloc(frames * size);
    for (let f = 0; f < frames; f += 1) out.set([0xff, 0xfb, MP3_KBPS.indexOf(kbps) << 4, 0x00], f * size);
    return out;
}
const ID3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)]);
const whole = (...parts) => { const b = new Uint8Array(Buffer.concat(parts)); return mp3Seconds(b, b.length); };

test('MP3 length is its frames, counted one by one past an ID3 tag', () => {
    // 383 frames * 1152 samples / 44100 = 10.005 s
    assert.equal(whole(ID3, mp3(383)).toFixed(3), '10.005');
    assert.equal(sniffType(new Uint8Array(Buffer.concat([ID3, mp3(2)]))), 'audio/mpeg');
    assert.deepEqual(MP3_FRAME, [...mp3(1).subarray(0, 4)]);
});

test('MP3: a Xing frame count that understates the file is not believed', () => {
    const file = mp3(383);
    const x = 4 + 32; // stereo MPEG-1
    file.write('Xing', x, 'latin1'); file[x + 7] = 1; file.writeUInt32BE(10, x + 8); // "10 frames": a quarter of a second
    assert.equal(whole(file).toFixed(3), '10.005');
});

test('MP3: frames of different bitrates are each counted, and bytes that are not a frame are stepped over', () => {
    const junk = Buffer.from('TAG not audio, and no frame starts in here');
    assert.equal(whole(mp3(100, 64), junk, mp3(100, 320), junk).toFixed(3), ((200 * 1152) / 44100).toFixed(3));
});

test('MP3: a partial read, a Layer II frame or a free-format frame leaves the length unknown', () => {
    const file = new Uint8Array(mp3(383));
    assert.equal(mp3Seconds(file.subarray(0, 4096), file.length), null, 'every frame is needed');
    assert.equal(whole(mp3(10), Buffer.from([0xff, 0xfd, 0x90, 0x00]), mp3(10)), null, 'Layer II');
    assert.equal(whole(mp3(10), Buffer.from([0xff, 0xfb, 0x00, 0x00]), mp3(10)), null, 'free format');
    assert.equal(whole(Buffer.alloc(5000)), null, 'no frame at all');
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

test('MP4 frame size from the first tkhd that has one (an audio track has none)', async () => {
    const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(600, 12); mvhd.writeUInt32BE(3000, 16); // 5 s
    const tkhd = (w, h) => { const t = Buffer.alloc(84); t.writeUInt32BE(w * 65536, 76); t.writeUInt32BE(h * 65536, 80); return box('tkhd', t); };
    const moov = box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', tkhd(0, 0)), box('trak', tkhd(720, 1280))]));
    const file = Buffer.concat([box('ftyp', Buffer.from('isom0000')), moov]);
    const readRange = async (s, e) => new Uint8Array(file.subarray(s, e + 1));
    assert.deepEqual(await mp4Info(readRange, file.length), { seconds: 5, width: 720, height: 1280 });
});

// A track as a decoder sees it: header length in movie ticks, media timescale, and a time-to-sample table.
function trak({ headerTicks = 0, scale = 1000, samples = [], width = 0, height = 0 } = {}) {
    const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(headerTicks, 20); tkhd.writeUInt32BE(width * 65536, 76); tkhd.writeUInt32BE(height * 65536, 80);
    const mdhd = Buffer.alloc(24); mdhd.writeUInt32BE(scale, 12);
    const stts = Buffer.alloc(8 + samples.length * 8); stts.writeUInt32BE(samples.length, 4);
    samples.forEach(([count, delta], k) => { stts.writeUInt32BE(count, 8 + k * 8); stts.writeUInt32BE(delta, 12 + k * 8); });
    return box('trak', Buffer.concat([box('tkhd', tkhd), box('mdia', Buffer.concat([box('mdhd', mdhd), box('minf', box('stbl', box('stts', stts)))]))]));
}
const mvhdOf = (scale, ticks) => { const m = Buffer.alloc(100); m.writeUInt32BE(scale, 12); m.writeUInt32BE(ticks, 16); return box('mvhd', m); };
const mp4 = (...top) => { const file = Buffer.concat([box('ftyp', Buffer.from('isom0000')), ...top]); return mp4Info(async (s, e) => new Uint8Array(file.subarray(s, e + 1)), file.length); };

test('MP4: headers that understate the file lose to the sample table a decoder plays from', async () => {
    // Movie and track headers both say 1 s. The table holds 950 frames of 40 ms: 38 s.
    const liar = box('moov', Buffer.concat([mvhdOf(1000, 1000), trak({ headerTicks: 1000, samples: [[950, 40]], width: 640, height: 360 })]));
    assert.deepEqual(await mp4(liar), { seconds: 38, width: 640, height: 360 });
});

test('MP4: the longest of the movie header, a track header and a sample table is the length', async () => {
    const byTrackHeader = box('moov', Buffer.concat([mvhdOf(1000, 5000), trak({ headerTicks: 9000, samples: [[100, 40]] })]));
    assert.equal((await mp4(byTrackHeader)).seconds, 9);
    const twoTracks = box('moov', Buffer.concat([mvhdOf(600, 3000), trak({ scale: 44100, samples: [[300, 1024]] }), trak({ scale: 30, samples: [[240, 1]] })]));
    assert.equal((await mp4(twoTracks)).seconds, 8, '5 s header, 6.97 s audio, 8 s video');
});

test('MP4: a fragmented file is refused, because its samples are not in the table', async () => {
    const plain = [mvhdOf(1000, 0), trak({ samples: [] })];
    assert.equal(await mp4(box('moov', Buffer.concat([...plain, box('mvex', Buffer.alloc(8))]))), null, 'mvex in the movie box');
    const honest = box('moov', Buffer.concat([mvhdOf(1000, 5000), trak({ samples: [[125, 40]] })]));
    assert.equal(await mp4(honest, box('moof', Buffer.alloc(16)), box('mdat', Buffer.alloc(64))), null, 'a fragment after the movie box');
    assert.equal(await mp4(box('moov', Buffer.concat(plain))), null, 'and a file with no length at all is unknown, not zero');
});

test('MP4: only the real movie header is read, and a table cut short proves nothing', async () => {
    // The bytes "mvhd" inside another box used to be taken for the header.
    const decoy = Buffer.alloc(100); decoy.write('mvhd', 4, 'latin1'); decoy.writeUInt32BE(1000, 20); decoy.writeUInt32BE(1, 24);
    const moov = box('moov', Buffer.concat([box('free', decoy), mvhdOf(1000, 12500)]));
    assert.equal((await mp4(moov)).seconds, 12.5);
    const stts = Buffer.alloc(16); stts.writeUInt32BE(500, 4); // says 500 entries, holds one
    const cut = box('trak', box('mdia', Buffer.concat([box('mdhd', (() => { const m = Buffer.alloc(24); m.writeUInt32BE(1000, 12); return m; })()), box('minf', box('stbl', box('stts', stts)))])));
    assert.equal(await mp4(box('moov', Buffer.concat([mvhdOf(1000, 5000), cut]))), null);
    assert.equal(await mp4(box('moov', Buffer.concat([mvhdOf(1000, 5000), box('free', Buffer.alloc(4 * 1024 * 1024))]))), null, 'a movie box over 4 MiB');
});

test('the gateway reads a whole MP3 before measuring it', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../lib/resolveSource.js', import.meta.url), 'utf8');
    assert.match(source, /mp3Seconds\(bytes\.length >= size \? bytes : await readRange\(0, size - 1\), size\)/);
});
