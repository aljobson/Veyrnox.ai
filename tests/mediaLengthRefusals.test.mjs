// A length is measured only from a file that reads one way. Each structure
// below can be read two ways, so it is refused (null) and the caller answers
// source_length_unknown before any debit. The ordinary file next to each case
// is still measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wavSeconds, mp3Seconds, mp4Info } from '../lib/mediaLength.js';

// ---- WAV ----

const chunk = (id, payload) => {
    const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32LE(payload.length, 4);
    return Buffer.concat([h, payload, Buffer.alloc(payload.length & 1)]);
};
// A fmt chunk: the 16 classic fields, then any extension bytes.
function fmt({ tag = 1, channels = 1, rate = 8000, bits = 8, blockAlign, extra = Buffer.alloc(0) } = {}) {
    const frame = blockAlign ?? channels * Math.ceil(bits / 8);
    const f = Buffer.alloc(16);
    f.writeUInt16LE(tag, 0); f.writeUInt16LE(channels, 2); f.writeUInt32LE(rate, 4);
    f.writeUInt32LE(rate * frame, 8); f.writeUInt16LE(frame, 12); f.writeUInt16LE(bits, 14);
    return chunk('fmt ', Buffer.concat([f, extra]));
}
// The 24 bytes an extensible fmt chunk adds: size, valid bits, channel mask, SubFormat.
function extension(subTag, bits) {
    const e = Buffer.alloc(24);
    e.writeUInt16LE(22, 0); e.writeUInt16LE(bits, 2); e.writeUInt32LE(3, 4); e.writeUInt16LE(subTag, 8);
    Buffer.from([0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71]).copy(e, 10);
    return e;
}
const data = (bytes) => chunk('data', Buffer.alloc(bytes));
function wav(...chunks) {
    const body = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
    const h = Buffer.alloc(8); h.write('RIFF'); h.writeUInt32LE(body.length, 4);
    return new Uint8Array(Buffer.concat([h, body]));
}
// As the gateway calls it: the first 128 KiB, and the stored size.
const wavLength = (file) => wavSeconds(file.subarray(0, 128 * 1024), file.length);

test('WAV: a second fmt chunk is refused', () => {
    const first = fmt({ rate: 8000, channels: 1, bits: 8 });
    const second = fmt({ rate: 48000, channels: 2, bits: 16 });
    assert.equal(wavLength(wav(first, second, data(1_900_000))), null);
    assert.equal(wavLength(wav(first, data(1_900_000))), 237.5, 'one fmt chunk is measured');
});

test('WAV: the bit depth must fit the format, and the frame is channels x sample size', () => {
    assert.equal(wavLength(wav(fmt({ tag: 6, bits: 0, blockAlign: 65535 }), data(960_000))), null, 'A-law with no bit depth');
    assert.equal(wavLength(wav(fmt({ tag: 1, bits: 0, blockAlign: 65535 }), data(960_000))), null, 'PCM with no bit depth');
    assert.equal(wavLength(wav(fmt({ channels: 0, blockAlign: 65535 }), data(960_000))), null, 'no channels');
    assert.equal(wavLength(wav(fmt({ tag: 6 }), data(960_000))), 120, 'A-law is one byte a sample');
    assert.equal(wavLength(wav(fmt({ tag: 7, blockAlign: 65535 }), data(960_000))), 120, 'and a frame size field cannot stretch it');
    assert.equal(wavLength(wav(fmt({ tag: 3, bits: 32, rate: 48000, channels: 2 }), data(384_000 * 3))), 3, 'float');
});

test('WAV: an extensible format is measured only when its SubFormat has a fixed frame', () => {
    const extensible = (subTag) => fmt({ tag: 0xfffe, channels: 2, rate: 48000, bits: 16, extra: extension(subTag, 16) });
    assert.equal(wavLength(wav(extensible(0x55), data(108_000))), null, 'a compressed stream in an extensible header');
    assert.equal(wavLength(wav(fmt({ tag: 0xfffe, channels: 2, rate: 48000, bits: 16 }), data(108_000))), null, 'no SubFormat at all');
    assert.equal(wavLength(wav(extensible(1), data(192_000 * 5))), 5, 'PCM in an extensible header');
});

test('WAV: a fmt chunk too short to hold its fields is refused', () => {
    const short = Buffer.alloc(14);
    short.writeUInt16LE(1, 0); short.writeUInt16LE(1, 2); short.writeUInt32LE(8000, 4); short.writeUInt32LE(8000, 8); short.writeUInt16LE(65535, 12);
    assert.equal(wavLength(wav(chunk('fmt ', short), data(960_000))), null);
});

// ---- MP3 ----

// MPEG-1 Layer III frames at 44.1 kHz, 128 kbps: a header and a silent payload of the frame's real size.
function mp3(frames) {
    const size = Math.floor((144000 * 128) / 44100);
    const out = Buffer.alloc(frames * size);
    for (let f = 0; f < frames; f += 1) out.set([0xff, 0xfb, 0x90, 0x00], f * size);
    return out;
}
const id3 = (...afterMagic) => Buffer.from([0x49, 0x44, 0x33, ...afterMagic]);
const mp3Length = (...parts) => { const b = new Uint8Array(Buffer.concat(parts)); return mp3Seconds(b, b.length); };
const seconds = (frames) => ((frames * 1152) / 44100).toFixed(3);

test('MP3: a tag header that is not a well-formed ID3v2 header is refused', () => {
    assert.equal(mp3Length(id3(3, 0, 0, 0x80, 0x19, 0x19, 0x1e), mp3(1000)), null, 'a size byte with its high bit set');
    assert.equal(mp3Length(id3(0xff, 0, 0, 0, 0x19, 0x19, 0x1e), mp3(1000)), null, 'a version of 0xFF');
    assert.equal(mp3Length(id3(4, 0, 0, 0, 0, 2, 0), Buffer.alloc(256), mp3(383)).toFixed(3), seconds(383), 'a well-formed tag is stepped past');
    assert.equal(mp3Length(id3(3, 0, 0, 0, 0, 0, 0), id3(4, 0, 0, 0, 0, 0, 0), mp3(383)).toFixed(3), seconds(383), 'and so is a second one');
});

test('MP3: a file that is mostly not MP3 frames is refused', () => {
    const other = Buffer.alloc(300_000, 0x55);
    assert.equal(mp3Length(mp3(10), other), null, 'frames first');
    assert.equal(mp3Length(id3(3, 0, 0, 0, 0, 0, 0), other, mp3(10)), null, 'frames last');
    const id3v1 = Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125, 0x20)]);
    assert.equal(mp3Length(mp3(383), id3v1).toFixed(3), seconds(383), 'a trailing ID3v1 tag is still fine');
    assert.equal(mp3Length(mp3(383), Buffer.alloc(1024, 0x55)).toFixed(3), seconds(383), 'up to 1 KiB outside frames');
    assert.equal(mp3Length(mp3(383), Buffer.alloc(1025, 0x55)), null, 'and no more');
});

// ---- MP4 ----

const box = (type, ...parts) => {
    const payload = Buffer.concat(parts);
    const h = Buffer.alloc(8); h.writeUInt32BE(8 + payload.length, 0); h.write(type, 4, 'latin1');
    return Buffer.concat([h, payload]);
};
const mvhd = (scale, ticks) => { const m = Buffer.alloc(100); m.writeUInt32BE(scale, 12); m.writeUInt32BE(ticks, 16); return box('mvhd', m); };
const tkhd = (ticks) => { const t = Buffer.alloc(84); t.writeUInt32BE(ticks, 20); t.writeUInt32BE(640 * 65536, 76); t.writeUInt32BE(360 * 65536, 80); return box('tkhd', t); };
const mdhd = (scale) => { const m = Buffer.alloc(24); m.writeUInt32BE(scale, 12); return box('mdhd', m); };
function stts(...runs) {
    const s = Buffer.alloc(8 + runs.length * 8); s.writeUInt32BE(runs.length, 4);
    runs.forEach(([count, delta], k) => { s.writeUInt32BE(count, 8 + k * 8); s.writeUInt32BE(delta, 12 + k * 8); });
    return box('stts', s);
}
// An edit list: [length in movie ticks, media time (-1 = empty), speed].
function elst(...edits) {
    const e = Buffer.alloc(8 + edits.length * 12); e.writeUInt32BE(edits.length, 4);
    edits.forEach(([ticks, mediaTime, speed = 1], k) => {
        e.writeUInt32BE(ticks, 8 + k * 12); e.writeInt32BE(mediaTime, 12 + k * 12); e.writeUInt16BE(speed, 16 + k * 12);
    });
    return box('edts', box('elst', e));
}
const SHORT = stts([200, 40]);    // 8 s at 1000 ticks a second
const LONG = stts([15000, 40]);   // 600 s
const tables = (...sttsBoxes) => box('minf', box('stbl', ...sttsBoxes));
// Movie and track headers both say 8 s; `inTrak` is what follows the track header.
function mp4Length(...inTrak) {
    const moov = box('moov', mvhd(1000, 8000), box('trak', tkhd(8000), ...inTrak));
    const file = Buffer.concat([box('ftyp', Buffer.from('isom0000')), moov]);
    return mp4Info(async (s, e) => new Uint8Array(file.subarray(s, e + 1)), file.length);
}

test('MP4: a track with a sample table and no media header is refused', async () => {
    assert.equal(await mp4Length(box('mdia', tables(LONG))), null);
    assert.equal((await mp4Length(box('mdia', mdhd(1000), tables(LONG)))).seconds, 600, 'with its media header it is measured');
});

test('MP4: a second sample table is refused, wherever it sits', async () => {
    assert.equal(await mp4Length(box('mdia', mdhd(1000), tables(SHORT, LONG))), null, 'two in one table box');
    assert.equal(await mp4Length(box('mdia', mdhd(1000), tables(SHORT), tables(LONG))), null, 'in a second media information box');
    assert.equal(await mp4Length(box('mdia', mdhd(1000), tables(SHORT)), box('mdia', mdhd(1000), tables(LONG))), null, 'in a second media box');
    assert.equal(await mp4Length(box('mdia', mdhd(1000), box('minf', box('dinf', LONG), box('stbl', SHORT)))), null, 'outside the table box');
    assert.equal(await mp4Length(box('mdia', mdhd(1000), box('minf', box('dinf', LONG)))), null, 'a single table outside the stbl path, where a lenient reader still finds it');
    assert.equal((await mp4Length(box('mdia', mdhd(1000), tables(SHORT)))).seconds, 8, 'one table is measured');
});

test('MP4: an edit list is read, and one a player could read two ways is refused', async () => {
    const media = box('mdia', mdhd(1000), tables(SHORT));
    assert.equal(await mp4Length(elst(...new Array(75).fill([8000, 0])), media), null, 'the same media, many times over');
    assert.equal(await mp4Length(elst([8000, 0, 0]), media), null, 'an edit at a speed other than 1');
    assert.equal(await mp4Length(elst([8000, 0]), elst([8000, 0]), media), null, 'two edit boxes');
    const cut = Buffer.alloc(20); cut.writeUInt32BE(5, 4); // says 5 edits, holds one
    assert.equal(await mp4Length(box('edts', box('elst', cut)), media), null, 'a list cut short');
    assert.equal((await mp4Length(elst([8000, 0]), media)).seconds, 8, 'one plain edit is measured from the sample table');
    assert.equal((await mp4Length(elst([8000, 1024]), media)).seconds, 8, 'a non-zero media start within the media is fine');
    assert.equal(await mp4Length(elst([2000, -1], [8000, 0]), media), null, 'a delayed start (two edits) is not modelled');
    assert.equal(await mp4Length(elst([600000, 0]), media), null, 'an edit presenting more than the media holds is refused');
});
