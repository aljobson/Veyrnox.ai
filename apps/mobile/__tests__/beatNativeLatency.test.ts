import { calibrationFrames, capturedSamples, detectClickOnsets, matchCalibration, readLatency, writeLatency } from '../src/lib/beatNative/takeShared';
import { createLatencyStorage } from '../src/lib/beatNative/latencyStore';
import { takeIO } from './beatNativeTakeFixtures';
import { deferred } from './beatNativeFixtures';
test('eight delayed clicks recover loopback latency within 1 ms and expire after 90 days', async () => {
    const io = takeIO(), storage = createLatencyStorage(io), sr = 48000, frames = calibrationFrames(sr), delay = 123 * sr / 1000;
    const samples = new Float32Array(sr * 8);
    for (const frame of frames) for (let i = 0; i < 144; i++) samples[Math.round(frame + delay) + i] = 0.5 * Math.sin(2 * Math.PI * 2000 * i / sr);
    const captured = capturedSamples([{ frame: 0, samples }], 0, samples.length);
    const result = matchCalibration(detectClickOnsets(captured, sr), frames, sr);
    expect(result.ok).toBe(true); expect(Math.abs(result.ms! - 123)).toBeLessThan(1);
    expect(writeLatency('default', result.ms!, storage, 100)).toBe(true); await storage.flush();
    const reopened = createLatencyStorage(io); await reopened.hydrate(); expect(readLatency('default', reopened, 101)?.ms).toBe(result.ms);
    expect(readLatency('default', reopened, 100 + 90 * 86400000)).toBeNull();
});

test('hydration emits and preserves measurements written while the file read was pending', async () => {
    const io = takeIO(), gate = deferred<Uint8Array | null>(), storage = createLatencyStorage({ ...io, read: () => gate.promise });
    const listener = jest.fn(); storage.subscribe(listener); const hydrate = storage.hydrate();
    expect(writeLatency('default', 42, storage, 200)).toBe(true);
    gate.resolve(new TextEncoder().encode(JSON.stringify({ 'veyrnox.beat.latency.v1': JSON.stringify({ default: { ms: 10, measuredAt: 100 }, headset: { ms: 20, measuredAt: 100 } }) })));
    await hydrate; await storage.flush();
    expect(readLatency('default', storage, 201)?.ms).toBe(42); expect(readLatency('headset', storage, 201)?.ms).toBe(20);
    expect(listener).toHaveBeenCalledTimes(2);
    const reopened = createLatencyStorage(io); await reopened.hydrate(); expect(readLatency('default', reopened, 201)?.ms).toBe(42);
});

test('an early measurement waits for hydration before publishing and preserves other devices on disk', async () => {
    const io = takeIO(), gate = deferred<string[]>(), write = jest.fn(io.write);
    const storageName = 'veyrnox.beat.latency.v1';
    io.data.set('beat-latency.json.pending', new TextEncoder().encode(JSON.stringify({ [storageName]: JSON.stringify({ default: { ms: 10, measuredAt: 100 }, headset: { ms: 20, measuredAt: 100 } }) })));
    const storage = createLatencyStorage({ ...io, list: () => gate.promise, write });
    writeLatency('default', 42, storage, 200);
    const flush = storage.flush();
    await Promise.resolve(); await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    gate.resolve(['beat-latency.json.pending']); await flush;
    expect(readLatency('default', storage, 201)?.ms).toBe(42);
    const reopened = createLatencyStorage(io); await reopened.hydrate();
    expect(readLatency('default', reopened, 201)?.ms).toBe(42);
    expect(readLatency('headset', reopened, 201)?.ms).toBe(20);
});
