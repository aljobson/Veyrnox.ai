import test from 'node:test';
import assert from 'node:assert/strict';
import { usesWebKit, canEncodeSafariVideo, createSafariCanvasSource } from '../app/veyrnox/_lib/editorSafariEncoder.mjs';

test('Safari uses the bounded encoder, including other iOS browsers, without changing desktop Chromium', () => {
    for (const suffix of ['Version/26.5 Safari/605.1.15', 'CriOS/154.0 Mobile/15E148', 'FxiOS/143.0 Mobile/15E148']) assert.equal(usesWebKit(`AppleWebKit/605.1.15 ${suffix}`), true);
    for (const suffix of ['Chrome/154.0', 'Chromium/154.0', 'Edg/154.0', 'OPR/125.0']) assert.equal(usesWebKit(`AppleWebKit/537.36 ${suffix}`), false);
    assert.equal(usesWebKit('Gecko/20100101 Firefox/143.0'), false);
});

test('Safari encoder preserves each frame and fails on missing frames, stalls and cancellation', async t => {
    const keys = ['VideoEncoder', 'VideoFrame', 'EncodedVideoChunk'];
    const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    let mode = 'normal', supported = true, last, maxPending = 0;
    class Frame {
        constructor(_, timing) { Object.assign(this, timing); if (mode === 'frame-rounding') this.timestamp--; this.closed = false; }
        close() { this.closed = true; }
    }
    class Chunk {
        constructor(frame, type) { this.timestamp = frame.timestamp; this.duration = null; this.type = type; this.byteLength = 1; }
        copyTo(bytes) { bytes[0] = 0; }
    }
    class Encoder {
        static async isConfigSupported() { return { supported }; }
        constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.pending = []; this.frames = []; last = this; }
        configure(config) { this.config = config; this.state = 'configured'; }
        encode(frame, options) { this.frames.push(frame); this.pending.push(new Chunk(frame, options.keyFrame ? 'key' : 'delta')); maxPending = Math.max(maxPending, this.pending.length); }
        async flush() {
            if (mode === 'stall') return new Promise(() => {});
            const chunks = this.pending.splice(0);
            if (mode === 'missing') return;
            if (mode === 'error') { this.callbacks.error(new Error('Encoder failed')); return; }
            for (const chunk of chunks) { if (mode === 'wrong-timestamp') chunk.timestamp += 41667; this.callbacks.output(chunk, { decoderConfig: { codec: 'avc1.64002a' } }); }
        }
        close() { this.state = 'closed'; }
    }
    for (const [key, value] of Object.entries({ VideoFrame: Frame, VideoEncoder: Encoder, EncodedVideoChunk: Chunk })) Object.defineProperty(globalThis, key, { configurable: true, value });
    const canvas = { width: 1920, height: 1080 };
    const setup = async (options = {}) => {
        const writer = await createSafariCanvasSource(canvas, { frameRate: 24, bitrate: 16000000, ...options });
        const packets = [];
        writer.source.add = async packet => packets.push(packet);
        writer.source.close = () => {};
        return { writer, packets };
    };
    try {
        await t.test('quality mode outputs all 240 frames with exact timeline durations and no backlog', async () => {
            const { writer, packets } = await setup();
            try { for (let i = 0; i < 240; i++) await writer.add(i / 24, 1 / 24); }
            finally { writer.close(); }
            assert.equal(last.config.latencyMode, 'quality');
            assert.equal(last.config.bitrate, 16000000);
            assert.equal(packets.length, 240);
            assert.equal(maxPending, 1);
            assert.equal(packets.at(-1).timestamp + packets.at(-1).duration, 10);
            assert.ok(last.frames.every(frame => frame.closed));
            assert.equal(last.state, 'closed');
        });
        await t.test('an unsupported native codec cannot pass preflight', async () => {
            supported = false;
            assert.equal(await canEncodeSafariVideo(canvas), false);
            await assert.rejects(setup(), /cannot encode/);
            supported = true;
        });
        await t.test('a dropped frame cannot become a successful export', async () => {
            mode = 'missing'; const { writer } = await setup();
            try { await assert.rejects(writer.add(0, 1 / 24), /preserve every frame/); }
            finally { writer.close(); mode = 'normal'; }
        });
        await t.test('WebKit canvas timestamp rounding keeps the original timeline time', async () => {
            mode = 'frame-rounding'; const { writer, packets } = await setup();
            try { await writer.add(121 / 30, 1 / 30); assert.equal(packets[0].timestamp, 121 / 30); assert.equal(packets[0].duration, 1 / 30); }
            finally { writer.close(); mode = 'normal'; }
        });
        await t.test('a chunk from a different frame cannot pass correlation', async () => {
            mode = 'wrong-timestamp'; const { writer } = await setup();
            try { await assert.rejects(writer.add(0, 1 / 24), /preserve every frame/); }
            finally { writer.close(); mode = 'normal'; }
        });
        await t.test('asynchronous encoder errors are returned to the caller', async () => {
            mode = 'error'; const { writer } = await setup();
            try { await assert.rejects(writer.add(0, 1 / 24), /Encoder failed/); }
            finally { writer.close(); mode = 'normal'; }
        });
        await t.test('a stalled flush times out and closes its encoder', async () => {
            mode = 'stall'; const { writer } = await setup({ timeoutMs: 10 });
            try { await assert.rejects(writer.add(0, 1 / 24), /timed out/); assert.equal(last.state, 'closed'); }
            finally { writer.close(); mode = 'normal'; }
        });
        await t.test('cancel interrupts a stalled flush without waiting for the timeout', async () => {
            mode = 'stall'; const controller = new AbortController(), { writer } = await setup({ signal: controller.signal });
            const work = writer.add(0, 1 / 24); controller.abort();
            try { await assert.rejects(work, { name: 'AbortError' }); assert.equal(last.state, 'closed'); }
            finally { writer.close(); mode = 'normal'; }
        });
        await t.test('already cancelled exports do not allocate an encoder', async () => {
            const previous = last, controller = new AbortController(); controller.abort();
            await assert.rejects(setup({ signal: controller.signal }), { name: 'AbortError' });
            assert.equal(last, previous);
        });
    } finally {
        keys.forEach((key, index) => { if (saved[index]) Object.defineProperty(globalThis, key, saved[index]); else delete globalThis[key]; });
    }
});
