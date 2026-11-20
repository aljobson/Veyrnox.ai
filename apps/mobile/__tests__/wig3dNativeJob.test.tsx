import { act } from 'react';
import { createRoot } from 'test-renderer';
import { NativeWig3d } from '../src/components/liveEdit/NativeWig3d';
import type { Wig3dJob } from '../src/lib/liveEdit/wig3dNative';
const mockPut = jest.fn(), mockGet = jest.fn(), mockRender = jest.fn();
jest.mock('../src/lib/liveEdit/wig', () => ({
    overlayKey: (wig: { size: number }) => `size:${wig.size}`,
    getOverlay: (key: string) => mockGet(key), putOverlay: (...args: unknown[]) => mockPut(...args),
}));
jest.mock('../src/lib/liveEdit/wig3dNative', () => ({ nativeWigTask: (job: Wig3dJob) => mockRender(job) }));
const job = (size = 1): Wig3dJob => ({ wig: { style: '3d-bob', size, offset: 0, strength: 1 }, landmarks: new Float32Array(1434), width: 256, height: 256 });
const ready = () => ({ status: 'ready', image: { dispose: jest.fn() }, fade: 1 });
beforeEach(() => { jest.useFakeTimers(); mockPut.mockReset(); mockGet.mockReset(); mockRender.mockReset(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('render is deferred, rapid changes coalesce, cached jobs skip work, and unmount cancels pending work', async () => {
    const next = jest.fn(() => ({ done: true, value: ready() })), stop = jest.fn();
    mockRender.mockImplementation(() => ({ next, return: stop }));
    const root = createRoot(), notify = jest.fn();
    await act(async () => root.render(<NativeWig3d job={job()} onChange={notify} />));
    expect(next).not.toHaveBeenCalled();
    await act(async () => root.render(<NativeWig3d job={job(1.2)} onChange={notify} />));
    expect(stop).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(120));
    expect(next).toHaveBeenCalledTimes(1); expect(mockPut).toHaveBeenCalledWith('size:1.2', expect.objectContaining({ status: 'ready' }));
    expect(notify).toHaveBeenCalledTimes(1);
    mockGet.mockReturnValue({ status: 'ready' });
    await act(async () => root.render(<NativeWig3d job={job(.75)} onChange={notify} />));
    expect(mockRender).toHaveBeenCalledTimes(2);
    mockGet.mockReturnValue(undefined);
    await act(async () => root.render(<NativeWig3d job={job(1.3)} onChange={notify} />));
    await act(async () => root.unmount());
    await act(async () => jest.runAllTimers());
    expect(next).toHaveBeenCalledTimes(1); expect(mockPut).toHaveBeenCalledTimes(1);
});

test('a partially rendered task is closed on a new job and never publishes stale output', async () => {
    let time = 0; jest.spyOn(performance, 'now').mockImplementation(() => time += 10);
    const oldNext = jest.fn(() => ({ done: false })), oldReturn = jest.fn();
    mockRender.mockReturnValueOnce({ next: oldNext, return: oldReturn });
    mockRender.mockReturnValueOnce({ next: () => ({ done: true, value: ready() }), return: jest.fn() });
    const root = createRoot(), notify = jest.fn();
    await act(async () => root.render(<NativeWig3d job={job()} onChange={notify} />));
    await act(async () => jest.advanceTimersByTime(120));
    expect(oldNext).toHaveBeenCalledTimes(1); expect(mockPut).not.toHaveBeenCalled();
    await act(async () => root.render(<NativeWig3d job={job(1.2)} onChange={notify} />));
    expect(oldReturn).toHaveBeenCalledTimes(1);
    await act(async () => jest.runAllTimers());
    expect(oldNext).toHaveBeenCalledTimes(1); expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith('size:1.2', expect.objectContaining({ status: 'ready' }));
    await act(async () => root.unmount());
});

test('an unexpected task failure settles unavailable and notifies once', async () => {
    const stop = jest.fn(); mockRender.mockReturnValue({ next: () => { throw Error('failed'); }, return: stop });
    const root = createRoot(), notify = jest.fn();
    await act(async () => root.render(<NativeWig3d job={job()} onChange={notify} />));
    await act(async () => jest.runAllTimers());
    expect(stop).toHaveBeenCalled(); expect(mockPut).toHaveBeenCalledWith('size:1', { status: 'unavailable' });
    expect(notify).toHaveBeenCalledTimes(1); await act(async () => root.unmount());
});
