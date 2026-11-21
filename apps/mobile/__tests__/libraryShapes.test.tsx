import { act, useEffect } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { ApiError, type ApiClient } from '../src/lib/api';
import type { Job, Kind } from '../src/lib/media';
import { useLibraryShapes } from '../src/lib/useLibraryShapes';

const request = jest.fn();
const api = { request } as unknown as ApiClient;
const kinds = new Map<string, Kind>([['video', 'video']]);
const jobs: Job[] = ['a', 'b'].map(job_id => ({ job_id, state: 'succeeded', has_asset: true, model_id: 'video', credits: 1, created_at: '2026-11-21' }));
const shape = (job_id: string) => ({ job_id, width: 1080, height: 1920 });
let root: Root, shown: Job[];
function Probe({ focused, refreshKey, rows }: { focused: boolean; refreshKey: number; rows: Job[] }) {
    const measured = useLibraryShapes(api, rows, rows.map(job => job.job_id), kinds, 'owner', focused, refreshKey);
    useEffect(() => { shown = measured; }, [measured]);
    return null;
}
async function render(focused = true, refreshKey = 0, rows = jobs) {
    await act(async () => root.render(<Probe focused={focused} refreshKey={refreshKey} rows={rows} />));
}
const batches = () => request.mock.calls.map(([, options]) => JSON.parse(options.body).job_ids);
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers(); request.mockReset(); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });

test.each(['failed', 'partial'] as const)('%s batch retries missing ids once after refocus with no loop while focused', async result => {
    if (result === 'failed') request.mockRejectedValueOnce(new Error('offline'));
    else request.mockResolvedValueOnce({ shapes: [shape('a')] });
    request.mockResolvedValue({ shapes: [] });
    await render(); await render();
    await act(async () => jest.advanceTimersByTimeAsync(60_000));
    expect(batches()).toEqual([['a', 'b']]);
    await render(false); await render(); await render();
    expect(batches()).toEqual([['a', 'b'], result === 'failed' ? ['a', 'b'] : ['b']]);
    await act(async () => jest.advanceTimersByTimeAsync(60_000));
    expect(request).toHaveBeenCalledTimes(2);
    if (result === 'partial') expect(shown[0].video_width).toBe(1080);
});
test('refresh completion restarts a failed pass once', async () => {
    request.mockRejectedValue(new Error('offline'));
    await render(); await render(true, 1); await render(true, 1);
    expect(batches()).toEqual([['a', 'b'], ['a', 'b']]);
});
test('429 cooldown survives refocus and refresh; its expiry does not loop after another failure', async () => {
    request.mockRejectedValue(new ApiError(429, 'rate_limited', { retryAfterSeconds: 60 }));
    await render(); await render(false); await render(); await render(true, 1);
    await act(async () => jest.advanceTimersByTimeAsync(59_999));
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTimeAsync(120_000));
    expect(request).toHaveBeenCalledTimes(2);
});
test('cooldown expiry without a new pass never retries', async () => {
    request.mockRejectedValue(new ApiError(429, 'rate_limited', { retryAfterSeconds: 1 }));
    await render(); await act(async () => jest.advanceTimersByTimeAsync(60_000)); await render();
    expect(request).toHaveBeenCalledTimes(1);
});
test('refocus during a request waits for settlement and keeps each batch bounded to 12', async () => {
    let finish!: (value: { shapes: ReturnType<typeof shape>[] }) => void;
    const rows = Array.from({ length: 13 }, (_, i) => ({ ...jobs[0], job_id: String(i) }));
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ shapes: [] });
    await render(true, 0, rows); await render(false, 0, rows); await render(true, 0, rows);
    expect(batches()).toEqual([rows.slice(0, 12).map(job => job.job_id)]);
    await act(async () => finish({ shapes: [shape('0')] }));
    expect(batches()).toEqual([rows.slice(0, 12).map(job => job.job_id), rows.slice(1).map(job => job.job_id)]);
    await render(true, 0, rows); expect(request).toHaveBeenCalledTimes(2);
});
