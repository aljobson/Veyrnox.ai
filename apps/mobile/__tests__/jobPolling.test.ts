import { ApiError } from '../src/lib/api';
import { mediaApi, waitForJob } from '../src/lib/media';
jest.mock('../src/lib/analytics/generations', () => ({ noteGenerationFinished: jest.fn() }));
let clock: number;
beforeEach(() => { clock = 0; jest.spyOn(Date, 'now').mockImplementation(() => clock); });
afterEach(() => jest.restoreAllMocks());
const fake = (getJob: jest.Mock) => ({ getJob }) as unknown as ReturnType<typeof mediaApi>;
const sleep = async (ms: number) => { clock += ms; };
test.each([new ApiError(0, 'network'), new ApiError(429, 'rate_limited'), new ApiError(503, 'unavailable'), new ApiError(0, 'network', { timedOut: true })])('one transient failure %p does not end polling', async error => {
    const get = jest.fn().mockRejectedValueOnce(error).mockResolvedValueOnce({ state: 'running' }).mockResolvedValue({ state: 'succeeded' });
    const update = jest.fn();
    await expect(waitForJob(fake(get), 'job', update, new AbortController().signal, sleep)).resolves.toBe('succeeded');
    expect(update.mock.calls).toEqual([['running'], ['succeeded']]);
});
test('backs off and gives up only after five consecutive failures', async () => {
    const get = jest.fn().mockRejectedValue(new Error('offline')), delays: number[] = [];
    await expect(waitForJob(fake(get), 'job', jest.fn(), new AbortController().signal, async ms => { delays.push(ms); await sleep(ms); })).rejects.toThrow('offline');
    expect(get).toHaveBeenCalledTimes(5); expect(delays).toEqual([3000, 6000, 12000, 24000]);
});
test('a successful check resets consecutive failures and backoff', async () => {
    const get = jest.fn();
    for (let batch = 0; batch < 2; batch++) {
        for (let i = 0; i < 4; i++) get.mockRejectedValueOnce(new Error('offline'));
        get.mockResolvedValueOnce({ state: batch ? 'succeeded' : 'running' });
    }
    await expect(waitForJob(fake(get), 'job', jest.fn(), new AbortController().signal, sleep)).resolves.toBe('succeeded');
    expect(get).toHaveBeenCalledTimes(10);
});
test('the ten-minute limit returns the running state and stops polling', async () => {
    const get = jest.fn().mockResolvedValue({ state: 'running' });
    await expect(waitForJob(fake(get), 'job', jest.fn(), new AbortController().signal, sleep)).resolves.toBe('running');
    expect(clock).toBe(600000); expect(get).toHaveBeenCalledTimes(200);
});
test('abort during a read prevents publication, and abort during backoff prevents another request', async () => {
    const controller = new AbortController(), update = jest.fn();
    const get = jest.fn(async () => { controller.abort(); return { state: 'succeeded' }; });
    await waitForJob(fake(get), 'job', update, controller.signal, sleep);
    expect(update).not.toHaveBeenCalled();
    const retry = new AbortController(), failing = jest.fn().mockRejectedValue(new Error('offline'));
    await waitForJob(fake(failing), 'job', update, retry.signal, async () => retry.abort());
    expect(failing).toHaveBeenCalledTimes(1);
});
