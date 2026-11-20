import { validateSwapResult, swapMasks, createSwapVisionJob } from '../src/lib/liveEdit/swapProtocol';
const frame = { sourceId: 1, frameId: 2, width: 32, height: 32, jpeg: 'data:image/jpeg;base64,AAAA' };
const result = (width = 32, height = 32) => ({ ...frame, id: 1, width, height, count: 1, landmarks: Array(1434).fill(.5), ...Object.fromEntries(['background', 'body', 'face'].map(k => [k, Buffer.alloc(width * height, 128).toString('base64')])) });
test.each([[384, 256], [383, 301], [382, 301], [383, 302]])('padded masks decode exactly at %ix%i', (width, height) => {
    const r = validateSwapResult(result(width, height), { ...frame, width, height });
    expect(swapMasks(r).background[0]).toBeCloseTo(128 / 255);
    expect(swapMasks(r).body).toHaveLength(width * height);
});
test('strict frame, finite landmarks, masks and message budget', () => {
    for (const patch of [{ id: 0 }, { width: 31 }, { height: 385 }, { sourceId: 3 }, { count: 2 }, { count: 0 }, { count: '1' }, { landmarks: [] }, { landmarks: Array(1434).fill(Infinity) }, { background: 'AA==' }, { background: Buffer.alloc(1024, 128).toString('base64').slice(0, -2) + 'A=' }, { extra: 'x'.repeat(6_000_001) }]) expect(() => validateSwapResult({ ...result(), ...patch }, frame)).toThrow();
    for (const count of [0, 2]) {
        expect(validateSwapResult({ ...frame, id: 1, count, landmarks: [] }, frame).count).toBe(count);
        expect(() => validateSwapResult({ ...frame, id: 1, count, landmarks: [], face: null }, frame)).toThrow();
    }
});
test('swap job uses swapDetect, one request, timeout and close-on-error', async () => {
    jest.useFakeTimers();
    const transport = { send: jest.fn(), close: jest.fn() }, job = createSwapVisionJob(transport);
    const init = job.init(); job.receive('{"id":1,"ready":true}'); await init;
    const pending = job.detect(frame);
    expect(JSON.parse(transport.send.mock.calls[1][0]).op).toBe('swapDetect');
    await expect(job.detect(frame)).rejects.toThrow('inference-busy');
    const rejected = expect(pending).rejects.toThrow(); job.receive('bad'); await rejected;
    expect(transport.close).toHaveBeenCalledTimes(1);
    const other = createSwapVisionJob(transport), p = other.init(); const timeout = expect(p).rejects.toThrow('inference-timeout');
    jest.advanceTimersByTime(60_000); await timeout; jest.useRealTimers();
});
