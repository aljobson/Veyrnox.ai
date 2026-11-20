import { createNativeVisionTransport, type NativeVisionModule } from '../src/lib/liveEdit/nativeVision';
import { createVisionJob, type Frame } from '../src/lib/liveEdit/protocol';
import { createSwapVisionJob } from '../src/lib/liveEdit/swapProtocol';
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
const frame: Frame = { sourceId: 3, frameId: 8, width: 8, height: 8, jpeg: 'data:image/jpeg;base64,AAAA' };
// Synthetic wire fixtures: contract coverage, not a claim of measured native/WASM accuracy.
const oneFace = { count: 1, landmarks: Array.from({ length: 478 }, () => [.5, .5, 0]).flat(), width: 8, height: 8, hair: Array(64).fill(204) };
const noFace = { count: 0, landmarks: [], hair: null, width: 8, height: 8 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mockModule() {
    const listeners = new Set<(e: { token: string }) => void>();
    const calls: { owner: string; token: string; op: string; reply: ReturnType<typeof deferred<Record<string, unknown>>> }[] = [];
    const native: NativeVisionModule = {
        init: jest.fn(async () => {}), cancel: jest.fn(),
        addListener: (_event, listener) => { listeners.add(listener); return { remove: () => { listeners.delete(listener); } }; },
        detect: jest.fn((owner, token, op) => { const reply = deferred<Record<string, unknown>>(); calls.push({ owner, token, op, reply }); return reply.promise; }),
    };
    return { native, calls, listeners, admit: (index: number) => listeners.forEach(fn => fn({ token: calls[index].token })) };
}
function setup(mock: ReturnType<typeof mockModule>, swap = false) {
    const transport = createNativeVisionTransport(message => job.receive(message), mock.native);
    const job = swap ? createSwapVisionJob(transport) : createVisionJob(transport);
    return job;
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => { expect(jest.getTimerCount()).toBe(0); jest.useRealTimers(); });
test.each([0, 1, 2])('native detect accepts count %i through unchanged validator', async count => {
    const m = mockModule(), job = setup(m); await job.init();
    const pending = job.detect(frame); m.admit(0);
    m.calls[0].reply.resolve(count === 1 ? oneFace : { ...noFace, count });
    await expect(pending).resolves.toMatchObject({ count, sourceId: 3, frameId: 8 }); job.close();
    expect(m.listeners.size).toBe(0);
});
test.each([0, 1, 2])('native swap validates all masks and frame dimensions for count %i', async count => {
    const m = mockModule(), job = setup(m, true); await job.init();
    const pending = job.detect(frame); m.admit(0);
    const mask = btoa(String.fromCharCode(...Array.from({ length: 64 }, (_, i) => i * 4)));
    m.calls[0].reply.resolve({ count, landmarks: count === 1 ? oneFace.landmarks : [], width: 8, height: 8,
        ...(count === 1 ? { background: mask, body: mask, face: mask } : {}) });
    const result = await pending;
    expect(result.count).toBe(count); expect(m.calls[0].op).toBe('swapDetect');
    if ('background' in result) expect(Array.from(result.background!)).toEqual(Array.from({ length: 64 }, (_, i) => i * 4));
    job.close();
});
test.each([{ ...oneFace, landmarks: [0] }, { ...oneFace, hair: [256] }, { ...oneFace, count: '1' }])('malformed native result fails closed', async fixture => {
    const m = mockModule(), job = setup(m); await job.init();
    const pending = job.detect(frame); m.admit(0); m.calls[0].reply.resolve(fixture);
    await expect(pending).rejects.toThrow('invalid-inference'); expect(m.listeners.size).toBe(0);
});
test('malformed swap mask fails unchanged validator', async () => {
    const m = mockModule(), job = setup(m, true); await job.init();
    const pending = job.detect(frame); m.admit(0); m.calls[0].reply.resolve({ ...oneFace, background: 'bad', body: 'bad', face: 'bad' });
    await expect(pending).rejects.toThrow('invalid-inference');
});
test('old binary / Expo Go reports unavailable', async () => {
    const transport = createNativeVisionTransport(message => job.receive(message)), job = createVisionJob(transport);
    await expect(job.init()).rejects.toThrow('inference-unavailable');
});
test('cold init takes 20 seconds and then gets its entire inference budget', async () => {
    const m = mockModule(), ready = deferred<void>(); m.native.init = () => ready.promise;
    const job = setup(m), init = job.init();
    await jest.advanceTimersByTimeAsync(20_000); expect(m.calls).toHaveLength(0);
    ready.resolve(); await init;
    const pending = job.detect(frame); m.admit(0); await jest.advanceTimersByTimeAsync(1_000);
    m.calls[0].reply.resolve(noFace); await expect(pending).resolves.toMatchObject({ count: 0 }); job.close();
});
test('init over 60 seconds times out and ignores late readiness', async () => {
    const m = mockModule(), ready = deferred<void>(); m.native.init = () => ready.promise;
    const job = setup(m), rejected = expect(job.init()).rejects.toThrow('inference-timeout');
    await jest.advanceTimersByTimeAsync(60_000); await rejected; ready.resolve(); await Promise.resolve();
    expect(m.calls).toHaveLength(0); expect(m.listeners.size).toBe(0);
});
test('single flight; cancelling releases owner and discards late running result', async () => {
    const m = mockModule(), a = setup(m); await a.init();
    const pending = a.detect(frame), cancelled = expect(pending).rejects.toThrow('inference-cancelled'); m.admit(0);
    await expect(a.detect(frame)).rejects.toThrow('inference-busy'); a.close(); await cancelled;
    expect(m.native.cancel).toHaveBeenCalledWith(m.calls[0].owner, m.calls[0].token);
    const b = setup(m); await b.init(); const replacement = b.detect(frame);
    expect(m.calls[1].token).not.toBe(m.calls[0].token);
    expect(m.calls[1].owner).not.toBe(m.calls[0].owner);
    m.calls[0].reply.resolve(oneFace); m.admit(1); m.calls[1].reply.resolve(noFace);
    await expect(replacement).resolves.toMatchObject({ count: 0 }); b.close();
});
test('A runs 14 seconds; B queued at t=1 succeeds after 13 seconds waiting plus 3 running', async () => {
    const m = mockModule(), a = setup(m); await a.init();
    const old = a.detect(frame), cancelled = expect(old).rejects.toThrow('inference-cancelled'); m.admit(0);
    await jest.advanceTimersByTimeAsync(1_000); a.close(); await cancelled;
    const b = setup(m); await b.init(); const replacement = b.detect(frame);
    await jest.advanceTimersByTimeAsync(13_000); m.calls[0].reply.resolve({ cancelled: true }); m.admit(1);
    await jest.advanceTimersByTimeAsync(3_000); m.calls[1].reply.resolve(noFace);
    await expect(replacement).resolves.toMatchObject({ count: 0 }); b.close();
});
test.each(['queue', 'inference'])('%s timeout cancels token; immediate retry stays usable', async phase => {
    const m = mockModule(), a = setup(m); await a.init();
    const rejected = expect(a.detect(frame)).rejects.toThrow('inference-timeout');
    if (phase === 'inference') m.admit(0);
    await jest.advanceTimersByTimeAsync(15_000); await rejected;
    expect(m.native.cancel).toHaveBeenCalledWith(m.calls[0].owner, m.calls[0].token);
    const b = setup(m); await b.init(); const replacement = b.detect(frame);
    m.calls[0].reply.resolve(oneFace); m.admit(0); m.admit(1); m.calls[1].reply.resolve(noFace);
    await expect(replacement).resolves.toMatchObject({ count: 0 }); b.close();
});
test('duplicate admission cannot extend the inference deadline', async () => {
    const m = mockModule(), job = setup(m); await job.init();
    const rejected = expect(job.detect(frame)).rejects.toThrow('inference-timeout'); m.admit(0);
    await jest.advanceTimersByTimeAsync(14_000); m.admit(0);
    await jest.advanceTimersByTimeAsync(1_000); await rejected;
});
// Script native admission/replies explicitly: these verify the JS contract, not native execution.
test('A running, B queued, then C: independent owners complete in FIFO order', async () => {
    const m = mockModule(), a = setup(m), b = setup(m), c = setup(m);
    await Promise.all([a.init(), b.init(), c.init()]);
    const completed: string[] = [];
    const first = a.detect(frame).then(() => completed.push('A')); m.admit(0);
    const second = b.detect(frame).then(() => completed.push('B'));
    const third = c.detect(frame).then(() => completed.push('C'));
    expect(new Set(m.calls.map(call => call.owner)).size).toBe(3);
    await jest.advanceTimersByTimeAsync(1_000); expect(completed).toEqual([]);
    m.calls[0].reply.resolve(noFace); await first; expect(completed).toEqual(['A']);
    m.admit(1); await jest.advanceTimersByTimeAsync(1_000);
    m.calls[1].reply.resolve(noFace); await second; expect(completed).toEqual(['A', 'B']);
    m.admit(2); m.calls[2].reply.resolve(oneFace); await third;
    expect(completed).toEqual(['A', 'B', 'C']); expect(m.native.cancel).not.toHaveBeenCalled();
    a.close(); b.close(); c.close();
});
test('same owner replaces its queued job quietly and retains its FIFO position', async () => {
    const m = mockModule(), a = setup(m), c = setup(m), receive = jest.fn(), admitted = jest.fn();
    const b = createNativeVisionTransport(receive, m.native); b.onAdmitted!(admitted);
    await Promise.all([a.init(), c.init()]);
    const first = a.detect(frame); m.admit(0);
    b.send(JSON.stringify({ ...frame, op: 'detect', id: 1 }));
    const third = c.detect(frame);
    b.send(JSON.stringify({ ...frame, op: 'detect', id: 2 }));
    expect(m.calls[3].owner).toBe(m.calls[1].owner);
    expect(m.calls[3].token).not.toBe(m.calls[1].token);
    m.calls[1].reply.resolve({ cancelled: true }); m.admit(1); await Promise.resolve();
    expect(receive).not.toHaveBeenCalled(); expect(admitted).not.toHaveBeenCalled();
    m.calls[0].reply.resolve(noFace); await first;
    m.admit(3); m.calls[3].reply.resolve(oneFace); await Promise.resolve();
    expect(admitted).toHaveBeenCalledWith(2); expect(receive).toHaveBeenCalledTimes(1);
    expect(JSON.parse(receive.mock.calls[0][0])).toMatchObject({ id: 2, count: 1 });
    m.admit(2); m.calls[2].reply.resolve(noFace); await third;
    a.close(); b.close(); c.close(); expect(m.native.cancel).not.toHaveBeenCalled();
});
test('cancelled reply for the current token is not delivered or turned into an error', async () => {
    const m = mockModule(), receive = jest.fn(), transport = createNativeVisionTransport(receive, m.native);
    transport.send(JSON.stringify({ ...frame, op: 'detect', id: 1 }));
    m.calls[0].reply.resolve({ cancelled: true }); await Promise.resolve();
    expect(receive).not.toHaveBeenCalled(); expect(m.listeners.size).toBe(1);
    transport.close(); expect(m.native.cancel).not.toHaveBeenCalled(); expect(m.listeners.size).toBe(0);
});
test('a fifth queued owner fails the oldest queued owner with busy; the other four complete', async () => {
    const m = mockModule(), jobs = Array.from({ length: 6 }, () => setup(m));
    await Promise.all(jobs.map(job => job.init()));
    const pending = jobs.map(job => job.detect(frame)); m.admit(0);
    const overflow = expect(pending[1]).rejects.toThrow('inference-busy');
    m.calls[1].reply.resolve({ error: 'inference-busy' }); await overflow;
    expect(m.listeners.size).toBe(5);
    for (const index of [0, 2, 3, 4, 5]) {
        if (index !== 0) m.admit(index);
        await jest.advanceTimersByTimeAsync(1_000);
        m.calls[index].reply.resolve(noFace);
        await expect(pending[index]).resolves.toMatchObject({ count: 0 });
    }
    expect(m.native.cancel).not.toHaveBeenCalled(); jobs.forEach(job => job.close());
});
test('old native detect signature rejects as unavailable', async () => {
    const m = mockModule(); m.native.detect = jest.fn(async () => { throw Error('argument-count-mismatch'); });
    const job = setup(m); await job.init();
    await expect(job.detect(frame)).rejects.toThrow('inference-unavailable');
    expect(m.listeners.size).toBe(0);
});
