import test from 'node:test';
import assert from 'node:assert/strict';
import { createSafariAudioSource } from '../app/veyrnox/_lib/editorSafariAudio.mjs';

test('Safari AAC preserves priming, bounds padding and releases native resources', async t => {
    const keys = ['AudioEncoder', 'AudioData', 'EncodedAudioChunk', 'EncodedVideoChunk'];
    const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    let last, mode = 'normal';
    class Data {
        constructor(options) { Object.assign(this, options); this.closed = false; }
        close() { this.closed = true; }
    }
    class Chunk {
        constructor(timestamp, duration = 21333) { this.timestamp = timestamp; this.duration = duration; this.type = 'key'; this.byteLength = 1; }
        copyTo(bytes) { bytes[0] = 0; }
    }
    class Encoder {
        static async isConfigSupported() { return { supported: mode !== 'unsupported' }; }
        constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.encodeQueueSize = 0; this.frames = []; last = this; }
        configure(config) { this.config = config; this.state = 'configured'; }
        encode(frame) { this.frames.push(frame); }
        async flush() {
            if (mode === 'stall') return new Promise(() => {});
            if (mode === 'empty') return;
            if (mode === 'error') { this.callbacks.error(new Error('AAC encoder failed')); return; }
            // Native AAC can emit priming before zero and trailing packets after the timeline end.
            for (const time of [-44000, 0, 981333, 1002667]) this.callbacks.output(new Chunk(time), { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, description: new Uint8Array(0) } });
        }
        close() { this.state = 'closed'; }
    }
    for (const [key, value] of Object.entries({ AudioData: Data, AudioEncoder: Encoder, EncodedAudioChunk: Chunk, EncodedVideoChunk: class {} })) Object.defineProperty(globalThis, key, { configurable: true, value });
    const buffer = { sampleRate: 48000, numberOfChannels: 2, length: 48000, getChannelData: () => new Float32Array(48000) };
    const setup = async (options = {}) => {
        const writer = await createSafariAudioSource({ samples: 48000, ...options });
        const packets = [], metadata = [];
        writer.source.add = async (packet, meta) => { packets.push(packet); metadata.push(meta); };
        writer.source.close = () => {};
        return { writer, packets, metadata };
    };
    try {
        await t.test('padding cannot extend the master, while negative priming and AAC configuration survive', async () => {
            const { writer, packets, metadata } = await setup();
            try { await writer.add(buffer); await writer.close(); }
            finally { writer.dispose(); }
            assert.equal(packets.length, 3);
            assert.equal(packets[0].timestamp, -0.044);
            assert.equal(packets.at(-1).timestamp + packets.at(-1).duration, 1);
            assert.deepEqual(metadata[0].decoderConfig.description, new Uint8Array([0x11, 0x90]));
            assert.equal(last.frames[0].format, 'f32-planar');
            assert.equal(last.frames[0].numberOfFrames, 48000);
            assert.ok(last.frames.every(frame => frame.closed));
            assert.equal(last.state, 'closed');
        });
        await t.test('an unsupported AAC encoder fails before allocation', async () => {
            mode = 'unsupported'; const previous = last;
            try { await assert.rejects(setup(), /cannot encode AAC/); assert.equal(last, previous); }
            finally { mode = 'normal'; }
        });
        await t.test('missing audio is not a successful export', async () => {
            mode = 'empty'; const { writer } = await setup();
            try { await writer.add(buffer); await assert.rejects(writer.close(), /did not complete/); }
            finally { writer.dispose(); mode = 'normal'; }
        });
        await t.test('native errors are propagated', async () => {
            mode = 'error'; const { writer } = await setup();
            try { await writer.add(buffer); await assert.rejects(writer.close(), /AAC encoder failed/); }
            finally { writer.dispose(); mode = 'normal'; }
        });
        await t.test('a stalled AAC flush closes on timeout', async () => {
            mode = 'stall'; const { writer } = await setup({ timeoutMs: 10 });
            try { await writer.add(buffer); await assert.rejects(writer.close(), /timed out/); assert.equal(last.state, 'closed'); }
            finally { writer.dispose(); mode = 'normal'; }
        });
        await t.test('cancel interrupts an AAC flush', async () => {
            mode = 'stall'; const controller = new AbortController(), { writer } = await setup({ signal: controller.signal });
            try { await writer.add(buffer); const work = writer.close(); controller.abort(); await assert.rejects(work, { name: 'AbortError' }); assert.equal(last.state, 'closed'); }
            finally { writer.dispose(); mode = 'normal'; }
        });
        await t.test('a mix cannot exceed its timeline', async () => {
            const { writer } = await setup();
            try { await assert.rejects(writer.add({ ...buffer, length: 48001 }), /did not match/); }
            finally { writer.dispose(); }
        });
    } finally {
        keys.forEach((key, index) => { if (saved[index]) Object.defineProperty(globalThis, key, saved[index]); else delete globalThis[key]; });
    }
});
