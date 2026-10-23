import { ApiError } from '../src/lib/api';
import { createCheckinStatusReader } from '../src/lib/checkinStatus';

test.each([401, 403, 404, 409, 429])('status %s stops all retries until a new UTC day', async status => {
    let clock = Date.parse('2026-10-23T12:00:00Z');
    const fetch = jest.fn(async () => { throw new ApiError(status, 'account_unavailable'); });
    const reader = createCheckinStatusReader(fetch, () => clock);
    await reader.read();
    for (let i = 0; i < 30; i++) { clock += 60_000; await reader.read(); }
    expect(fetch).toHaveBeenCalledTimes(1); expect(reader.due()).toBe(false);
    clock += 86400000; await reader.read(); expect(fetch).toHaveBeenCalledTimes(2);
});
test.each([new ApiError(503, 'checkin_unavailable'), new ApiError(0, 'network')])('only network/5xx retries with a finite backoff budget: %s', async error => {
    let clock = Date.parse('2026-10-23T12:00:00Z');
    const fetch = jest.fn(async () => { throw error; });
    const reader = createCheckinStatusReader(fetch, () => clock);
    await reader.read();
    for (const delay of [60_000, 120_000, 240_000]) {
        const before = fetch.mock.calls.length;
        clock += delay - 1; await reader.read(); expect(fetch).toHaveBeenCalledTimes(before);
        clock++; await reader.read(); expect(fetch).toHaveBeenCalledTimes(before + 1);
    }
    clock += 3600000; await reader.read(); expect(fetch).toHaveBeenCalledTimes(4);
});
test('a successful or disabled status is reused without fetching again', async () => {
    const fetch = jest.fn(async () => null);
    const reader = createCheckinStatusReader(fetch);
    await reader.read(); await reader.read();
    expect(fetch).toHaveBeenCalledTimes(1);
});
