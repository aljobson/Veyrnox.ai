import { ApiError, type ApiClient } from '../src/lib/api';
import { createGenerationTracker } from '../src/lib/music/queue';
import { generation, input, view } from './fixtures/musicCreate';
let request: jest.Mock, tracker: ReturnType<typeof createGenerationTracker>, appState: (state: string) => void;
beforeEach(() => {
    jest.useFakeTimers(); request = jest.fn().mockResolvedValue(view);
    tracker = createGenerationTracker({ api: { request } as unknown as ApiClient, now: Date.now,
        subscribeAppState(fn) { appState = fn; return jest.fn(); } });
});
afterEach(() => { tracker.dispose(); jest.useRealTimers(); });
const tick = async (ms: number) => { await jest.advanceTimersByTimeAsync(ms); };
test('first poll at 800ms, then 2 seconds; terminal state stops', async () => {
    tracker.add(generation, input); await tick(799); expect(request).not.toHaveBeenCalled();
    await tick(1); expect(request).toHaveBeenCalledTimes(1); await tick(1999); expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue({ ...view, state: 'succeeded' }); await tick(1); expect(request).toHaveBeenCalledTimes(2);
    expect(tracker.activeCount()).toBe(0); await tick(20000); expect(request).toHaveBeenCalledTimes(2);
});
test('error backoff grows to 10s and foreground resumes', async () => {
    request.mockRejectedValue(new ApiError(500, 'internal')); tracker.add(generation, input);
    await tick(800); await tick(3999); expect(request).toHaveBeenCalledTimes(1); await tick(1); expect(request).toHaveBeenCalledTimes(2);
    await tick(8000); expect(request).toHaveBeenCalledTimes(3); await tick(9999); expect(request).toHaveBeenCalledTimes(3); await tick(1); expect(request).toHaveBeenCalledTimes(4);
    appState('background'); await tick(50000); expect(request).toHaveBeenCalledTimes(4);
    appState('active'); await tick(800); expect(request).toHaveBeenCalledTimes(5);
});
test('not_found marks only that generation missing; other 404s retry', async () => {
    request.mockRejectedValueOnce(new ApiError(404, 'not_found')); tracker.add(generation, input); await tick(800);
    expect(tracker.snapshot().entries[0].missing).toBe(true); expect(tracker.activeCount()).toBe(0); await tick(20000); expect(request).toHaveBeenCalledTimes(1);
    tracker.add({ ...generation, generation_id: 'other' }, input); request.mockRejectedValue(new ApiError(404, 'unknown')); await tick(800);
    expect(tracker.snapshot().entries[0].missing).toBe(false); await tick(4000); expect(request).toHaveBeenCalledTimes(3);
});
test('typed off cancels every scheduled poll and all later additions', async () => {
    request.mockRejectedValue(new ApiError(404, 'music_unavailable')); tracker.add(generation, input); await tick(800);
    expect(tracker.snapshot().state).toBe('off'); tracker.add({ ...generation, generation_id: 'other' }, input);
    appState('active'); await tick(20000); expect(request).toHaveBeenCalledTimes(1);
});
test('cap, ordering, replay merge, reset invalidates inflight responses', async () => {
    for (let i = 0; i < 25; i++) tracker.add({ ...generation, generation_id: String(i) }, input);
    tracker.add({ ...generation, generation_id: '24', idempotent: true }, input);
    expect(tracker.snapshot().entries).toHaveLength(20); expect(tracker.snapshot().entries[0].id).toBe('24');
    expect(tracker.activeCount()).toBe(20);
    let resolve!: (value: unknown) => void; request.mockImplementation(() => new Promise(r => { resolve = r; })); await tick(800);
    tracker.reset(); resolve(view); await tick(10000); expect(tracker.snapshot().entries).toEqual([]); expect(tracker.activeCount()).toBe(0);
});
test('terminal replay hydrates candidate song IDs before polling stops', async () => {
    request.mockResolvedValue({ ...view, state: 'succeeded' });
    tracker.add({ ...generation, state: 'succeeded', idempotent: true }, input);
    await tick(800); expect(request).toHaveBeenCalledTimes(1);
    expect(tracker.snapshot().entries[0].view).toEqual({ ...view, state: 'succeeded' });
    await tick(20000); expect(request).toHaveBeenCalledTimes(1);
});

test('unknown initial AppState waits for foreground before the first poll', async () => {
    tracker.dispose();
    tracker = createGenerationTracker({ api: { request } as unknown as ApiClient, initialAppState: null,
        subscribeAppState(fn) { appState = fn; return () => {}; } });
    tracker.add(generation, input); await tick(5000); expect(request).not.toHaveBeenCalled();
    appState('active'); await tick(800); expect(request).toHaveBeenCalledTimes(1);
});
