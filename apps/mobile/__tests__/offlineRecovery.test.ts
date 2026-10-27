import { startOfflineRecovery } from '../src/lib/offlineRecovery';
import { isOffline, markOffline, markOnline, resetNetworkState } from '../src/lib/networkState';
import { createApiClient } from '../src/lib/api';
let active: boolean;
let changed: (active: boolean) => void;
let stop: (() => void) | undefined;
const begin = (probe: () => Promise<boolean>) => {
    stop = startOfflineRecovery({ active: () => active, subscribe: fn => { changed = value => { active = value; fn(value); }; return () => {}; } }, probe);
};
beforeEach(() => { jest.useFakeTimers(); resetNetworkState(); active = true; });
afterEach(() => { stop?.(); jest.useRealTimers(); jest.restoreAllMocks(); });
test('offline failures back off 5s, 15s, 30s; success clears the mark and timer', async () => {
    const probe = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    begin(probe); markOffline();
    await jest.advanceTimersByTimeAsync(4999); expect(probe).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1); expect(probe).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(15000); expect(probe).toHaveBeenCalledTimes(2); expect(isOffline()).toBe(true);
    await jest.advanceTimersByTimeAsync(30000); expect(isOffline()).toBe(false);
    await jest.advanceTimersByTimeAsync(60000); expect(probe).toHaveBeenCalledTimes(3);
});
test('online neither probes on foreground nor starts timers', async () => {
    const probe = jest.fn(); begin(probe); changed(false); changed(true);
    await jest.advanceTimersByTimeAsync(120000); expect(probe).not.toHaveBeenCalled();
});
test('offline foreground immediately probes; background and unmount cancel scheduled work', async () => {
    const probe = jest.fn().mockResolvedValue(false); begin(probe); markOffline(); changed(false);
    await jest.advanceTimersByTimeAsync(60000); expect(probe).not.toHaveBeenCalled();
    changed(true); await Promise.resolve(); expect(probe).toHaveBeenCalledTimes(1);
    stop?.(); await jest.advanceTimersByTimeAsync(60000); expect(probe).toHaveBeenCalledTimes(1);
});
test('every authenticated API response recovers without an observe wrapper', async () => {
    const client = createApiClient({ baseUrl: 'https://example.test', getAccessToken: async () => 'token', onSessionLost: jest.fn() });
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);
    await expect(client.request('/api/test')).rejects.toMatchObject({ status: 0 }); expect(isOffline()).toBe(true);
    await client.request('/api/test'); expect(isOffline()).toBe(false);
});
test('ordinary recovery cancels a pending probe timer', async () => {
    const probe = jest.fn(); begin(probe); markOffline(); markOnline();
    await jest.advanceTimersByTimeAsync(60000); expect(probe).not.toHaveBeenCalled();
});
