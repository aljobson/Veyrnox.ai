// An MP3's frames are counted across the whole stored file. These pin how the
// file is read for that: the first 128 KiB as before, then the rest as a
// stream, one piece at a time, with no piece kept. What one measurement holds
// does not grow with the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_UPLOAD_TYPES, DIMENSION_BYTES, uploadKeyFor } from '../lib/uploadSource.js';
import { mp3Seconds } from '../lib/mediaLength.js';

const AUTH = '11111111-2222-3333-4444-555555555555';
const KEY = uploadKeyFor(AUTH, 'audio/mpeg', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee').key;
const CFG = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', jurisdiction: 'eu' };
const CAP = ALLOWED_UPLOAD_TYPES['audio/mpeg'].maxBytes;
const FRAME = 417;                  // MPEG-1 Layer III, 128 kbps, 44.1 kHz
const FRAME_SECONDS = 1152 / 44100;
const PIECE = 64 * 1024;

/** Fill `into` with bytes [start, start + into.length) of an endless run of silent frames. */
function silence(into, start) {
    into.fill(0);
    for (let p = start - (start % FRAME); p < start + into.length; p += FRAME) {
        [0xff, 0xfb, 0x90, 0x00].forEach((v, k) => { if (p + k >= start && p + k < start + into.length) into[p + k - start] = v; });
    }
    return into;
}
// Frames whose four header bytes are inside a file of `total` bytes.
const framesIn = (total) => Math.floor((total - 4) / FRAME) + 1;

/**
 * A stored MP3 of `total` bytes behind a stubbed R2, served by range. A body
 * longer than the first read comes in 64 KiB pieces that all share ONE buffer,
 * overwritten for each piece. A reader that keeps pieces to join them later
 * ends up with the last piece repeated and measures the wrong length; a reader
 * that finishes with each piece before asking for the next is unaffected.
 */
function stubStore(total, { endsAt = total } = {}) {
    const requests = [];
    const shared = new Uint8Array(PIECE);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
        const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
        const start = Number(from);
        const last = Math.min(Number(to), endsAt - 1);
        requests.push([start, Number(to)]);
        const reuse = Number(to) - start + 1 > DIMENSION_BYTES;
        let at = start;
        const body = new ReadableStream({
            pull(controller) {
                if (at > last) { controller.close(); return; }
                const size = Math.min(PIECE, last - at + 1);
                const piece = silence(reuse ? shared.subarray(0, size) : new Uint8Array(size), at);
                at += size;
                controller.enqueue(piece);
            },
        }, { highWaterMark: 0 });
        return new Response(body, { status: 206, headers: { 'content-range': `bytes ${start}-${to}/${total}` } });
    };
    return { requests, restore: () => { globalThis.fetch = realFetch; } };
}

const { resolveUploadedSource } = await import('../lib/resolveSource.js');

test('an MP3 at the 20 MiB cap is measured from a stream, and no piece of it is kept', async () => {
    const store = stubStore(CAP);
    try {
        const out = await resolveUploadedSource(AUTH, KEY, CFG);
        assert.equal(out.ok, true);
        assert.ok(Math.abs(out.seconds - framesIn(CAP) * FRAME_SECONDS) < 1e-6, `measured ${out.seconds} s`);
        assert.deepEqual(store.requests, [[0, DIMENSION_BYTES - 1], [DIMENSION_BYTES, CAP - 1]], 'the first read, then the rest once');
    } finally { store.restore(); }
});

test('an MP3 that fits in the first read costs no second one', async () => {
    const store = stubStore(100_000);
    try {
        const out = await resolveUploadedSource(AUTH, KEY, CFG);
        assert.ok(Math.abs(out.seconds - framesIn(100_000) * FRAME_SECONDS) < 1e-6, `measured ${out.seconds} s`);
        assert.equal(store.requests.length, 1);
    } finally { store.restore(); }
});

test('an MP3 whose body ends early has no known length', async () => {
    const store = stubStore(2_000_000, { endsAt: 1_500_000 });
    try {
        const out = await resolveUploadedSource(AUTH, KEY, CFG);
        assert.equal(out.ok, true);
        assert.equal(out.seconds, null);
    } finally { store.restore(); }
});

test('frames are counted the same whatever the size of the pieces', async () => {
    const { mp3FrameCounter } = await import('../lib/mediaLength.js');
    const tag = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x03, 0x00]), Buffer.alloc(384, 0xff)]);
    const file = new Uint8Array(Buffer.concat([tag, silence(Buffer.alloc(40_000), 0), Buffer.from('TAG'), Buffer.alloc(125, 0x20)]));
    const expected = mp3Seconds(file, file.length);
    assert.ok(Math.abs(expected - framesIn(40_000) * FRAME_SECONDS) < 1e-9, 'the tag is stepped past and the tail tolerated');
    for (const size of [1, 2, 3, 7, 10, 416, 417, 4096, file.length]) {
        const counter = mp3FrameCounter();
        // One buffer for every piece, as a stream may reuse its own.
        const piece = new Uint8Array(size);
        for (let at = 0; at < file.length; at += size) {
            const part = piece.subarray(0, Math.min(size, file.length - at));
            part.set(file.subarray(at, at + part.length));
            assert.equal(counter.push(part), true);
        }
        assert.equal(counter.end(), expected, `pieces of ${size}`);
    }
});

test('the counter says so as soon as the length cannot be known', async () => {
    const { mp3FrameCounter } = await import('../lib/mediaLength.js');
    const counter = mp3FrameCounter();
    assert.equal(counter.push(silence(new Uint8Array(4170), 0)), true);
    assert.equal(counter.push(new Uint8Array([0xff, 0xfd, 0x90, 0x00, 0, 0, 0, 0])), false, 'a Layer II frame');
    assert.equal(counter.push(silence(new Uint8Array(4170), 0)), false);
    assert.equal(counter.end(), null);
});
