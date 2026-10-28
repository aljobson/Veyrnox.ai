import { ApiError, createApiClient, REQUEST_TIMEOUT_MS } from '../src/lib/api';
import { markOffline, markOnline } from '../src/lib/networkState';

jest.mock('../src/lib/networkState', () => ({ markOffline: jest.fn(), markOnline: jest.fn() }));
const originalFetch = globalThis.fetch;
const stalled = () => new Promise<Response>(() => {});
const response = (status = 200) => ({ status, ok: status === 200, headers: new Headers(), json: async () => ({ ok: true }) }) as Response;
let fetcher: jest.Mock, lost: jest.Mock;
const client = () => createApiClient({ baseUrl: 'https://api.test', getAccessToken: async force => force ? 'new' : 'old', onSessionLost: lost, streamFetch: fetcher });
beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); lost = jest.fn();
    fetcher = jest.fn(stalled); globalThis.fetch = fetcher;
});
afterEach(() => { globalThis.fetch = originalFetch; jest.useRealTimers(); });
test.each(['request', 'stream'] as const)('%s bounds stalled headers even when fetch ignores abort', async method => {
    const pending = client()[method]('/slow');
    const check = expect(pending).rejects.toMatchObject({ status: 0, code: 'network', body: { timedOut: true } });
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(markOffline).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1); await check;
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(markOffline).toHaveBeenCalledTimes(1); expect(lost).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
});
test('fast headers clear the timer without timing the streamed body', async () => {
    fetcher.mockResolvedValue(response());
    await expect(client().request('/fast')).resolves.toEqual({ ok: true });
    expect(markOnline).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(markOffline).not.toHaveBeenCalled();
});
test.each([false, true])('caller abort is preserved (already aborted=%s)', async already => {
    const controller = new AbortController();
    const reason = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    if (already) controller.abort(reason);
    const pending = client().request('/cancel', { signal: controller.signal });
    const check = expect(pending).rejects.toBe(reason);
    await jest.advanceTimersByTimeAsync(100);
    if (!already) controller.abort(reason);
    await check;
    expect(markOffline).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
    if (!already) expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
test('401 retry receives a fresh thirty second deadline', async () => {
    fetcher.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(response(401)), 20_000)));
    const pending = client().request('/retry');
    const check = expect(pending).rejects.toEqual(new ApiError(0, 'network', { timedOut: true }));
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(markOffline).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(20_000); await check;
    expect(jest.getTimerCount()).toBe(0); expect(lost).not.toHaveBeenCalled();
});

test('caller abort still reaches the stream after headers, without a body deadline', async () => {
    const controller = new AbortController();
    fetcher.mockResolvedValue(response());
    await client().stream('/stream', { signal: controller.signal });
    const sentSignal = fetcher.mock.calls[0][1].signal;
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2);
    expect(sentSignal.aborted).toBe(false);
    controller.abort();
    expect(sentSignal.aborted).toBe(true);
    expect(markOffline).not.toHaveBeenCalled();
});
