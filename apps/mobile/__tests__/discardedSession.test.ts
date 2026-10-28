import * as SecureStore from 'expo-secure-store';
jest.mock('expo-secure-store', () => ({ setItem: jest.fn(), setItemAsync: jest.fn() }));
jest.mock('../src/lib/network', () => ({ defaultProbe: jest.fn(async () => true) }));
import { defaultProbe } from '../src/lib/network';
let discarded: typeof import('../src/lib/auth/discardedSession');
const fetchMock = jest.fn();
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); fetchMock.mockReset();
    jest.mocked(defaultProbe).mockResolvedValue(true);
    globalThis.fetch = fetchMock;
    jest.isolateModules(() => { discarded = require('../src/lib/auth/discardedSession'); });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
const exchange = () => new Response(JSON.stringify({ access_token: 'discarded-access', refresh_token: 'rotated-must-not-persist', expires_in: 3600 }));

test('only exchanges and logs out the discarded session locally, without any persistence', async () => {
    fetchMock.mockResolvedValueOnce(exchange()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    discarded.retainDiscardedSession('discarded-refresh');
    expect(fetchMock).not.toHaveBeenCalled();
    await discarded.revokeDiscardedSession();
    expect(defaultProbe).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/v1\/token\?grant_type=refresh_token$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refresh_token: 'discarded-refresh' });
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/auth\/v1\/logout\?scope=local$/);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer discarded-access');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); expect(SecureStore.setItem).not.toHaveBeenCalled();
    await discarded.revokeDiscardedSession(); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
});

test('offline discards without exchanging', async () => {
    jest.mocked(defaultProbe).mockResolvedValue(false);
    discarded.retainDiscardedSession('old'); await discarded.revokeDiscardedSession();
    jest.mocked(defaultProbe).mockResolvedValue(true); await discarded.revokeDiscardedSession();
    expect(fetchMock).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});

test.each(['reject', 'http', 'malformed', 'logout'])('%s failure discards without retry or persistence', async mode => {
    if (mode === 'reject') fetchMock.mockRejectedValue(new Error('offline'));
    if (mode === 'http') fetchMock.mockResolvedValue(new Response('{}', { status: 400 }));
    if (mode === 'malformed') fetchMock.mockResolvedValue(new Response('{}'));
    if (mode === 'logout') fetchMock.mockResolvedValueOnce(exchange()).mockRejectedValue(new Error('offline'));
    discarded.retainDiscardedSession('old'); await discarded.revokeDiscardedSession();
    const calls = fetchMock.mock.calls.length;
    await discarded.revokeDiscardedSession(); expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});

test('30 second cap covers startup delay and a stalled exchange, and ignores late tokens', async () => {
    discarded.retainDiscardedSession('old'); jest.advanceTimersByTime(30_000);
    await discarded.revokeDiscardedSession(); expect(fetchMock).not.toHaveBeenCalled();
    jest.isolateModules(() => { discarded = require('../src/lib/auth/discardedSession'); });
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise(r => { resolve = r; }));
    discarded.retainDiscardedSession('old'); const work = discarded.revokeDiscardedSession(); await tick();
    jest.advanceTimersByTime(30_000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    resolve(exchange()); await work;
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('ordinary phone sign-out also limits logout to the local session', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await require('../src/lib/auth/supabaseAuth').revokeSession('current-access');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/v1\/logout\?scope=local$/);
});
