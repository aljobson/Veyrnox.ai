import { ApiError } from '../src/lib/api';
import { OfflineError, isNetworkError, isOffline, markOffline, observe, requireOnline, resetNetworkState, subscribe } from '../src/lib/network';

beforeEach(resetNetworkState);

describe('network state', () => {
    test('a failed connection marks offline and any response marks online', async () => {
        await expect(observe(Promise.reject(new ApiError(0, 'network')))).rejects.toBeInstanceOf(ApiError);
        expect(isOffline()).toBe(true);
        await observe(Promise.resolve(1));
        expect(isOffline()).toBe(false);
    });
    test('a server error is a response, so the device is online', async () => {
        markOffline();
        await expect(observe(Promise.reject(new ApiError(500, 'boom')))).rejects.toBeInstanceOf(ApiError);
        expect(isOffline()).toBe(false);
    });
    test('only a status-0 network error counts', () => {
        expect(isNetworkError(new ApiError(0, 'network'))).toBe(true);
        expect(isNetworkError(new ApiError(0, 'other'))).toBe(false);
        expect(isNetworkError(new Error('network'))).toBe(false);
    });
    test('listeners hear changes once, and can unsubscribe', () => {
        const fn = jest.fn();
        const off = subscribe(fn);
        markOffline();
        markOffline();
        expect(fn).toHaveBeenCalledTimes(1);
        off();
        resetNetworkState();
        markOffline();
        expect(fn).toHaveBeenCalledTimes(1);
    });
    test('a paid action is refused while offline, never queued', () => {
        expect(() => requireOnline()).not.toThrow();
        markOffline();
        expect(() => requireOnline()).toThrow(OfflineError);
    });
});
