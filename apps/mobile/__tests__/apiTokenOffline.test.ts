import { act, createElement } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { AuthError, refreshSession } from '../src/lib/auth/supabaseAuth';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from '../src/lib/auth/sessionStore';
import { resetCacheUser, userDocStorage, wipeCache } from '../src/lib/appCache';

jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn(async () => false) }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { setUser: jest.fn(), forget: jest.fn(async () => {}), ensure: jest.fn(async () => {}) } }));
jest.mock('../src/lib/cinemaProgress', () => ({ cinemaProgressIdentity: { setUser: jest.fn() } }));
jest.mock('../src/lib/auth/sessionStore', () => ({ readRefreshToken: jest.fn(), writeRefreshToken: jest.fn(async () => {}), clearRefreshToken: jest.fn(async () => {}) }));
jest.mock('../src/lib/auth/supabaseAuth', () => ({ ...jest.requireActual('../src/lib/auth/supabaseAuth'), refreshSession: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({ ...jest.requireActual('../src/lib/appCache'), userIdFromToken: () => 'U', wipeCache: jest.fn(async () => {}) }));

import { apiTokenSource, isTransientRefreshFailure } from '../src/lib/auth/apiToken';
import { ApiError, createApiClient } from '../src/lib/api';
test('transient null becomes a network error only for the API adapter', async () => {
    const original = jest.fn(async () => null);
    await expect(apiTokenSource(original, () => true)()).rejects.toEqual(new ApiError(0, 'network'));
    await expect(original()).resolves.toBeNull();
    await expect(apiTokenSource(original, () => false)()).resolves.toBeNull();
    await expect(apiTokenSource(async () => 'token', () => true)()).resolves.toBe('token');
});
test.each([true, false])('real ApiClient transient=%s session-loss behavior', async transient => {
    const onSessionLost = jest.fn();
    const api = createApiClient({ baseUrl: 'https://api.test', getAccessToken: apiTokenSource(async () => null, () => transient), onSessionLost });
    await expect(api.request('/api/v1/projects')).rejects.toMatchObject({ status: transient ? 0 : 401 });
    expect(onSessionLost).toHaveBeenCalledTimes(transient ? 0 : 1);
});
test('401 after successful forced refresh still drops the session', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => ({ status: 401 })) as unknown as typeof fetch;
    try {
        const onSessionLost = jest.fn();
        const api = createApiClient({ baseUrl: 'https://api.test', getAccessToken: apiTokenSource(async force => force ? 'new' : 'old', () => false), onSessionLost });
        await expect(api.request('/api/v1/projects')).rejects.toMatchObject({ status: 401 });
        expect(onSessionLost).toHaveBeenCalledTimes(1);
    } finally { globalThis.fetch = originalFetch; }
});


test.each([[new AuthError(0, 'network'), true], [new AuthError(400, 'invalid'), false], [new Error('unknown'), false]])('classifies refresh failures by status zero only', (error, expected) => {
    expect(isTransientRefreshFailure(error)).toBe(expected);
});

describe('AuthProvider refresh through the real ApiClient', () => {
    let root: Root, auth: ReturnType<typeof useAuth>;
    const statuses: string[] = [];
    function Probe() { auth = useAuth(); statuses.push(auth.status); return null; }
    async function mount() {
        await act(async () => root.render(createElement(AuthProvider, { children: createElement(Probe) })));
        expect(auth.status).toBe('signedIn');
    }
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        jest.clearAllMocks(); resetCacheUser(); statuses.length = 0;
        jest.mocked(readRefreshToken).mockResolvedValue('stored-refresh');
        jest.mocked(refreshSession).mockResolvedValue({ accessToken: 'access', refreshToken: 'rotated-refresh', expiresAt: 0 });
        root = createRoot();
    });
    afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
    test.each([0, 400])('refresh AuthError(%s) preserves or drops the adopted session', async status => {
        await mount();
        jest.mocked(refreshSession).mockRejectedValue(new AuthError(status, 'refresh_failed'));
        await act(async () => {
            await expect(auth.api.request('/api/v1/projects')).rejects.toMatchObject({ status: status === 0 ? 0 : 401 });
        });
        expect(refreshSession).toHaveBeenLastCalledWith('rotated-refresh');
        expect(auth.status).toBe(status === 0 ? 'signedIn' : 'signedOut');
        expect(wipeCache).toHaveBeenCalledTimes(status === 0 ? 0 : 1);
        expect(clearRefreshToken).toHaveBeenCalledTimes(status === 0 ? 0 : 1);
        expect(statuses.filter(value => value === 'signedOut')).toHaveLength(status === 0 ? 0 : 1);
        if (status === 0) {
            // Direct callers retain null; successful recovery clears the transient marker.
            await act(async () => { await expect(auth.getAccessToken()).resolves.toBeNull(); });
            jest.mocked(refreshSession).mockResolvedValue({ accessToken: 'recovered', refreshToken: 'new-refresh', expiresAt: 0 });
            await act(async () => { await expect(auth.getAccessToken()).resolves.toBe('recovered'); });
            expect(wipeCache).not.toHaveBeenCalled();
        }
    });
    test.each(['keys', 'remove'] as const)('sweep %s failure cannot reject provider adoption', async method => {
        jest.spyOn(userDocStorage, 'keys').mockResolvedValue(['foreign']);
        jest.spyOn(userDocStorage, 'get').mockResolvedValue('{"owner":"V"}');
        jest.spyOn(userDocStorage, method).mockRejectedValue(new Error('storage failed'));
        await mount();
        expect(writeRefreshToken).toHaveBeenCalledWith('rotated-refresh');
        expect(wipeCache).not.toHaveBeenCalled();
    });
});
