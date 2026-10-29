jest.mock('../src/lib/crash', () => ({ captureIssue: jest.fn() }));
import { act, type ReactNode } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { AuthError, refreshSession, signInWithPassword, revokeSession, type Session } from '../src/lib/auth/supabaseAuth';
import { readRefreshToken, writeRefreshToken, clearRefreshToken } from '../src/lib/auth/sessionStore';
import { bindCacheUser, wipeCache, getCacheUser, resetCacheUser } from '../src/lib/appCache';
import { setEditorMediaOwner } from '../src/lib/editorDeviceMedia';
import { captureEvent } from '../src/lib/analytics';
import { aiConsent } from '../src/lib/aiConsentStore';
import { fetch as streamFetch } from 'expo/fetch';
import { t } from '../src/lib/i18n';

jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn(async () => false) }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ setEditorMediaOwner: jest.fn(async () => {}) }));
jest.mock('../src/lib/cinemaUploadStore', () => ({ setOwner: jest.fn(async () => {}) }));
jest.mock('../src/lib/oddlingsAccountStore', () => ({ claimLegacyOddlings: jest.fn(async () => {}) }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { setUser: jest.fn(), forget: jest.fn(async () => {}), ensure: jest.fn(async () => {}) } }));
jest.mock('../src/lib/cinemaProgress', () => ({ cinemaProgressIdentity: { setUser: jest.fn() } }));
jest.mock('../src/lib/firstRunPending', () => ({ setFirstRunUser: jest.fn() }));
jest.mock('../src/lib/analytics', () => ({ captureEvent: jest.fn(), setAnalyticsUser: jest.fn() }));
jest.mock('../src/lib/auth/sessionStore', () => ({ readRefreshToken: jest.fn(async () => null), writeRefreshToken: jest.fn(async () => {}), clearRefreshToken: jest.fn(async () => {}) }));
jest.mock('../src/lib/auth/supabaseAuth', () => ({ ...jest.requireActual('../src/lib/auth/supabaseAuth'), refreshSession: jest.fn(), signInWithPassword: jest.fn(), revokeSession: jest.fn(async () => {}) }));



import * as SecureStore from 'expo-secure-store';
import * as vibeStore from '../src/lib/creatorProfileStore';
import { subscribeVibe } from '../src/lib/vibeEvents';
import { setOwner as setCinemaUploadOwner } from '../src/lib/cinemaUploadStore';
import type { CreatorAnswers } from '../src/lib/creatorAnswers';
const mockDisk = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async (key: string) => mockDisk.get(key) ?? null), setItemAsync: jest.fn(async (key: string, value: string) => { mockDisk.set(key, value); }), deleteItemAsync: jest.fn(async (key: string) => { mockDisk.delete(key); }) }));
jest.mock('../src/lib/creatorProfile', () => ({ ...jest.requireActual('../src/lib/creatorProfile'), CREATOR_PROFILE_ENABLED: true }));
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const answers: CreatorAnswers = { look: 'neon_rain', goal: 'story', pace: 'octopus', chaos: 2, destination: 'tiktok', audience: 'me', voice: 'calm' };
const chosen = (chaos = 2) => ({ version: 1 as const, state: 'completed' as const, answers: { ...answers, chaos }, synced: true });
const jwt = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`;
const makeSession = (user: string): Session => ({ accessToken: jwt(user), refreshToken: user, expiresAt: Date.now() + 3600000 });
const tick = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
let root: Root, auth: ReturnType<typeof useAuth>;
function Probe() { auth = useAuth(); return null; }
async function adopt(user = 'A') { await act(async () => { await auth.adoptSession(makeSession(user)); }); }
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); mockDisk.clear(); resetCacheUser();
    jest.mocked(aiConsent.forget).mockResolvedValue(); root = createRoot();
    await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>)); await adopt();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
void [RN.View, RN.Text];
test('adopting B while A’s drop clears vibes keeps B’s vibe and media ownership', async () => {
    await vibeStore.storeVibe(chosen(), 'A'); const gate = deferred();
    jest.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(async key => { expect(key).toBe('veyrnox.vibe.v1'); mockDisk.delete(key); })
        .mockImplementationOnce(async key => { expect(key).toBe('veyrnox.vibe.v2'); await gate.promise; mockDisk.delete(key); });
    let dropping!: Promise<void>; await act(async () => { dropping = auth.signOut(); await tick(); });
    await adopt('B'); const writing = vibeStore.storeVibe(chosen(4), 'B');
    jest.mocked(setCinemaUploadOwner).mockClear(); jest.mocked(setEditorMediaOwner).mockClear();
    await act(async () => { gate.resolve(); await dropping; await writing; });
    expect(await vibeStore.loadVibe()).toEqual(chosen(4)); expect(getCacheUser()).toBe('B');
    expect(setCinemaUploadOwner).not.toHaveBeenCalledWith(null); expect(setEditorMediaOwner).not.toHaveBeenCalledWith(null);
});
test('plain sign-out clears v1 and v2 then clears the refresh token', async () => {
    await vibeStore.storeVibe(chosen(), 'A'); mockDisk.set('veyrnox.vibe.v1', 'legacy');
    const clear = jest.spyOn(vibeStore, 'clearAllVibes'); await act(async () => { await auth.signOut(); });
    expect(clear).toHaveBeenCalledTimes(1); expect(mockDisk.size).toBe(0); expect(clearRefreshToken).toHaveBeenCalledTimes(1); expect(auth.status).toBe('signedOut');
    expect(jest.mocked(SecureStore.deleteItemAsync).mock.invocationCallOrder.at(-1)).toBeLessThan(jest.mocked(clearRefreshToken).mock.invocationCallOrder[0]);
});
test.each(['hydration', 'finish'] as const)('old %s after same-account sign-in is fenced even when cleanup never runs', async kind => {
    const response = deferred<any>(), forget = deferred();
    const api = { request: jest.fn(() => response.promise) };
    const clear = jest.spyOn(vibeStore, 'clearAllVibes');
    const old = kind === 'hydration' ? vibeStore.vibeOffered(api, auth.beginSessionTask()) : vibeStore.runVibeIntent(api, auth.beginSessionTask(), { kind: 'save', answers });
    await tick(); expect(api.request).toHaveBeenCalledTimes(1); jest.mocked(aiConsent.forget).mockReturnValueOnce(forget.promise);
    let dropping!: Promise<void>; await act(async () => { dropping = auth.signOut(); await tick(); });
    expect(getCacheUser()).toBe('A'); await adopt('A'); await act(async () => { forget.resolve(); await dropping; }); expect(clear).not.toHaveBeenCalled();
    const notify = jest.fn(), off = subscribeVibe(notify); response.resolve({ status: 'completed', answers });
    expect(await old).toEqual(kind === 'hydration' ? false : { kind: 'stale-session' }); expect(await vibeStore.loadVibe()).toBeNull(); expect(notify).not.toHaveBeenCalled(); off();
    expect(await vibeStore.vibeOffered(api, auth.beginSessionTask())).toBe(false); expect(await vibeStore.loadVibe()).toEqual(chosen());
});
