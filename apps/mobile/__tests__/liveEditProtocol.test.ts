import { createVisionJob, validateFrame, validateResult, MAX_MESSAGE, type Frame } from '../src/lib/liveEdit/protocol';
const frame: Frame = { sourceId: 1, frameId: 3, width: 32, height: 32, jpeg: 'data:image/jpeg;base64,AAAA' };
const noFace = { ...frame, count: 0, landmarks: [], hair: null };
afterEach(() => jest.useRealTimers());
test('input and message bounds reject malformed identifiers, dimensions and payloads', () => {
    validateFrame(frame);
    for (const patch of [{ sourceId: 0 }, { frameId: 1e6 }, { width: 385 }, { height: 7 }, { width: NaN }, { jpeg: 'https://example.com/private.jpg' }, { jpeg: 'data:image/jpeg;base64,' + 'a'.repeat(900000) }]) expect(() => validateFrame({ ...frame, ...patch })).toThrow('invalid-frame');
});
test('exactly one face and finite bounded 478 landmarks, hair shape and confidence are required', () => {
    expect(validateResult(noFace, frame).hair).toBeNull();
    expect(validateResult({ ...noFace, count: 2 }, frame).landmarks.length).toBe(0);
    const face = { ...noFace, count: 1, landmarks: Array(1434).fill(.5), width: 8, height: 8, hair: Array(64).fill(204) };
    expect(validateResult(face, frame).count).toBe(1);
    for (const patch of [{ sourceId: 2 }, { frameId: 2 }, { count: '1' }, { count: 3 }, { landmarks: [1] }, { landmarks: Array(1434).fill(Infinity) }, { landmarks: Array(1434).fill(2.01) }, { width: 513 }, { width: 8.5 }, { hair: [0] }, { hair: Array(64).fill(-1) }, { hair: Array(64).fill(NaN) }, { hair: Array(64).fill(256) }, { hair: Array(64).fill(.8) }, { hair: Array(64).fill(127.5) }]) expect(() => validateResult({ ...face, ...patch }, frame)).toThrow();
    expect(() => validateResult({ ...noFace, hair: [0] }, frame)).toThrow();
});
test('init, detect and stale responses, single in-flight request and cancellation', async () => {
    const transport = { send: jest.fn(), close: jest.fn() }, job = createVisionJob(transport);
    const init = job.init();
    job.receive(JSON.stringify({ id: 1, ready: true })); await expect(init).resolves.toBeNull();
    const pending = job.detect(frame);
    await expect(job.detect(frame)).rejects.toThrow('inference-busy');
    job.receive(JSON.stringify({ id: 1, ...noFace }));
    expect(transport.close).not.toHaveBeenCalled();
    job.receive(JSON.stringify({ id: 2, ...noFace }));
    await expect(pending).resolves.toMatchObject({ count: 0, sourceId: 1, frameId: 3 });
    const cancelled = job.detect(frame); job.close(); job.close();
    await expect(cancelled).rejects.toThrow('inference-cancelled');
    expect(transport.close).toHaveBeenCalledTimes(1);
    await expect(job.detect(frame)).rejects.toThrow('inference-cancelled');
});
test('timeout destroys the transport and late results cannot revive it', async () => {
    jest.useFakeTimers();
    const transport = { send: jest.fn(), close: jest.fn() }, job = createVisionJob(transport, 20);
    const promise = job.detect(frame); const rejection = expect(promise).rejects.toThrow('inference-timeout');
    jest.advanceTimersByTime(20); await rejection;
    job.receive(JSON.stringify({ id: 1, ...noFace })); expect(transport.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});
test.each(['not json', 'x'.repeat(MAX_MESSAGE + 1), JSON.stringify({ id: 1, ...noFace, sourceId: 8 })])('malformed result fails closed', async payload => {
    const transport = { send: jest.fn(), close: jest.fn() }, job = createVisionJob(transport);
    const pending = job.detect(frame); job.receive(payload);
    await expect(pending).rejects.toThrow('invalid-inference'); expect(transport.close).toHaveBeenCalledTimes(1);
});
test('transport send failure rejects and cancels immediately', async () => {
    const close = jest.fn(), job = createVisionJob({ send: () => { throw Error(); }, close });
    await expect(job.init()).rejects.toThrow('inference-unavailable'); expect(close).toHaveBeenCalledTimes(1);
});
test('associated hair is retained but background clutter and no-hair confidence are suppressed', () => {
    // Bounding oval with finite canonical points; no real face or image.
    const landmarks = Array(1434).fill(.5); landmarks[10 * 3] = .4; landmarks[10 * 3 + 1] = .3;
    landmarks[152 * 3] = .6; landmarks[152 * 3 + 1] = .7;
    const hair = Array(32 * 32).fill(0);
    for (let y = 2; y < 12; y++) for (let x = 10; x < 22; x++) hair[y * 32 + x] = 230;
    hair[31] = 230;
    const result = validateResult({ ...frame, count: 1, landmarks, width: 32, height: 32, hair }, frame);
    expect(result.hair?.hair[5 * 32 + 15]).toBeCloseTo(230 / 255, 5); expect(result.hair?.hair[31]).toBe(0);
    expect(validateResult({ ...frame, count: 1, landmarks, width: 32, height: 32, hair: hair.map(() => 25) }, frame).hair).toBeNull();
});

test('worst-case 512x512 hair mask fits one bridge message with wide margin', () => {
    // Long float JSON (e.g. 1.2345678359270096e-7, ~24 chars each) would exceed MAX_MESSAGE; the wire carries 0-255 integers.
    const hair = Array.from({ length: 512 * 512 }, (_, i) => (i * 37) % 256);
    const wire = JSON.stringify({ id: 1, ...frame, count: 1, landmarks: Array(1434).fill(-0.123456789012345678), width: 512, height: 512, hair });
    expect(wire.length).toBeLessThan(MAX_MESSAGE / 3);
    // Background confidences are tiny float32 values (~1e-6); widened to doubles they serialise to ~24 characters each.
    const floatWire = JSON.stringify(Array.from({ length: 512 * 512 }, (_, i) => Math.fround(((i * 2654435761) % 1000003) / 1000003 * 1e-5)));
    expect(floatWire.length).toBeGreaterThan(MAX_MESSAGE); // documents why floats cannot be sent
});
