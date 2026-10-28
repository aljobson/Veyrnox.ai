import { act, type ReactNode } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { AuthError, refreshSession, signInWithPassword, revokeSession, type Session } from '../src/lib/auth/supabaseAuth';
import { readRefreshToken, writeRefreshToken, clearRefreshToken } from '../src/lib/auth/sessionStore';
import { bindCacheUser, wipeCache, getCacheUser } from '../src/lib/appCache';
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
jest.mock('../src/lib/appCache', () => ({ userIdFromToken: jest.requireActual('../src/lib/auth/tokenUser').tokenUser,
    bindCacheUser: jest.fn(async () => {}), wipeCache: jest.fn(async () => {}), clearExportFiles: jest.fn(), getCacheUser: jest.fn(() => 'A'), subscribeCacheUser: jest.fn(() => () => {}) }));

function deferred<T = void>() {
    let resolve!: (value: T) => void, reject!: (err: unknown) => void;
    const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject };
}
const jwt = (sub: string, n = 0, aal = 'aal1') => `h.${btoa(JSON.stringify({ sub, n, aal }))}.s`;
const session = (user: string, n = 0): Session => ({ accessToken: jwt(user, n), refreshToken: `${user}-${n}`, expiresAt: Date.now() + 3600000 });
const response = (status = 200, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let root: Root, auth: ReturnType<typeof useAuth>, send: jest.Mock;
const statuses: string[] = [];
function Probe() { auth = useAuth(); statuses.push(auth.status); return null; }
async function mount(children?: ReactNode) { await act(async () => root.render(<AuthProvider><Probe />{children}</AuthProvider>)); }
async function adopt(user = 'A', n = 0) { await act(async () => { await auth.adoptSession(session(user, n)); }); jest.mocked(getCacheUser).mockReturnValue(user); }
async function switchToB() {
    const pause = deferred(); jest.mocked(setEditorMediaOwner).mockImplementationOnce(() => pause.promise);
    statuses.length = 0; let leaving!: Promise<void>;
    await act(async () => { leaving = auth.signOut(); });
    await adopt('B'); await act(async () => { pause.resolve(); await leaving; });
    expect(statuses.length).toBeGreaterThan(0); expect(statuses.every(s => s === 'signedIn')).toBe(true);
}
const controls = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
async function press(label: string) { await act(async () => { const nodes = controls(label); expect(nodes).toHaveLength(1); nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); }); }
const texts = (text: string) => root.container.queryAll(n => n.children.includes(text));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); statuses.length = 0;
    jest.mocked(readRefreshToken).mockResolvedValue(null); jest.mocked(refreshSession).mockReset();
    jest.mocked(writeRefreshToken).mockResolvedValue(); jest.mocked(clearRefreshToken).mockResolvedValue();
    jest.mocked(bindCacheUser).mockResolvedValue(); jest.mocked(setEditorMediaOwner).mockResolvedValue();
    jest.mocked(aiConsent.ensure).mockResolvedValue(); jest.mocked(getCacheUser).mockReturnValue('A');
    send = jest.fn(async () => response()); globalThis.fetch = send; root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
import { changePassword } from '../src/lib/auth/accountCalls';
import { MfaGate } from '../src/components/account/MfaGate';
import { forgetMfaCleared, mfaClearedFor } from '../src/lib/mfaCheck';

beforeEach(forgetMfaCleared);
test.each(['request', 'stream'] as const)('A %s 401 after B signs in leaves B signed in', async method => {
    await mount(); await adopt(); const gate = deferred<Response>();
    (method === 'request' ? send : streamFetch as jest.Mock).mockReturnValueOnce(gate.promise);
    let result!: Promise<any>; await act(async () => { result = auth.api[method]('/post', { method: 'POST' }).catch(e => e); });
    await adopt('B'); await act(async () => { gate.resolve(response(401)); await result; });
    expect(await result).toMatchObject({ code: 'account_changed' }); expect(refreshSession).not.toHaveBeenCalled();
    expect(clearRefreshToken).not.toHaveBeenCalled(); expect(wipeCache).not.toHaveBeenCalled();
    expect(auth.status).toBe('signedIn'); expect(await auth.getAccessToken()).toBe(jwt('B'));
});
test('A resend 401 after B signs in leaves B signed in', async () => {
    await mount(); await adopt(); const gate = deferred<Response>(); send.mockResolvedValueOnce(response(401)).mockReturnValueOnce(gate.promise);
    jest.mocked(refreshSession).mockResolvedValueOnce(session('A', 1));
    let result!: Promise<any>; await act(async () => { result = auth.api.request('/post').catch(e => e); });
    expect(send).toHaveBeenCalledTimes(2); await adopt('B');
    await act(async () => { gate.resolve(response(401)); await result; });
    expect(await result).toMatchObject({ code: 'account_changed' }); expect(clearRefreshToken).not.toHaveBeenCalled(); expect(await auth.getAccessToken()).toBe(jwt('B'));
});
test.each([false, true])('A refresh settling after B never adopts or drops B (rejected=%s)', async rejected => {
    await mount(); await adopt(); const gate = deferred<Session>(); jest.mocked(refreshSession).mockReturnValueOnce(gate.promise);
    let result!: Promise<string | null>; await act(async () => { result = auth.getAccessToken(true); }); await adopt('B');
    await act(async () => { if (rejected) gate.reject(new AuthError(401, 'rejected')); else gate.resolve(session('A', 1)); await result; });
    expect(await result).toBeNull(); expect(writeRefreshToken).toHaveBeenLastCalledWith('B-0'); expect(bindCacheUser).toHaveBeenLastCalledWith('B');
    expect(clearRefreshToken).not.toHaveBeenCalled(); expect(await auth.getAccessToken()).toBe(jwt('B'));
});
test('B forced refresh does not join A superseded run', async () => {
    await mount(); await adopt(); const gate = deferred<Session>(); jest.mocked(refreshSession).mockReturnValueOnce(gate.promise).mockResolvedValueOnce(session('B', 1));
    let a!: Promise<string | null>; await act(async () => { a = auth.getAccessToken(true); }); await adopt('B');
    await act(async () => { await auth.getAccessToken(true); }); expect(refreshSession).toHaveBeenLastCalledWith('B-0');
    await act(async () => { gate.resolve(session('A', 1)); await a; }); expect(await auth.getAccessToken()).toBe(jwt('B', 1));
});
test('refresh overlapping same-user step-up returns live session without replacing it', async () => {
    await mount(); await adopt(); const gen = auth.sessionGeneration(), gate = deferred<Session>(); jest.mocked(refreshSession).mockReturnValueOnce(gate.promise);
    let a!: Promise<string | null>; await act(async () => { a = auth.getAccessToken(true); });
    await act(async () => { await auth.adoptSession(session('A', 2), gen); });
    await act(async () => { gate.resolve(session('A', 1)); await a; });
    expect(await a).toBe(jwt('A', 2)); expect(auth.sessionGeneration()).toBe(gen); expect(writeRefreshToken).toHaveBeenLastCalledWith('A-2');
});
test('adopt A paused before persistence rejects after B without writing A token', async () => {
    await mount(); const gate = deferred(); jest.mocked(bindCacheUser).mockReturnValueOnce(gate.promise);
    let a!: Promise<any>; await act(async () => { a = auth.adoptSession(session('A')).catch(e => e); }); await adopt('B');
    await act(async () => { gate.resolve(); await a; });
    expect(await a).toMatchObject({ code: 'account_changed' }); expect(jest.mocked(writeRefreshToken).mock.calls).toEqual([['B-0']]);
});
test('paused sign-out cannot clear B token or status', async () => {
    await mount(); await adopt(); await switchToB();
    expect(clearRefreshToken).not.toHaveBeenCalled(); expect(auth.status).toBe('signedIn'); expect(await auth.getAccessToken()).toBe(jwt('B'));
});
test('getAccessToken during paused sign-out cannot reload persisted A', async () => {
    await mount(); await adopt(); const gate = deferred(); jest.mocked(setEditorMediaOwner).mockReturnValueOnce(gate.promise);
    let out!: Promise<void>; await act(async () => { out = auth.signOut(); }); jest.mocked(readRefreshToken).mockClear();
    await act(async () => { expect(await auth.getAccessToken()).toBeNull(); });
    expect(readRefreshToken).not.toHaveBeenCalled(); expect(refreshSession).not.toHaveBeenCalled();
    await act(async () => { gate.resolve(); await out; }); expect(clearRefreshToken).toHaveBeenCalledTimes(1); expect(auth.status).toBe('signedOut');
});
test('transient launch failure can retry the persisted token at generation zero', async () => {
    jest.mocked(readRefreshToken).mockResolvedValue('stored'); jest.mocked(refreshSession).mockRejectedValueOnce(new AuthError(0, 'network')).mockResolvedValueOnce(session('A'));
    await mount(); expect(auth.generation).toBe(0);
    await act(async () => { expect(await auth.getAccessToken()).toBe(jwt('A')); }); expect(readRefreshToken).toHaveBeenCalledTimes(2); expect(auth.generation).toBe(1);
});
test.each(['drop', 'B', 'wrong-user'])('MFA adoption refuses stale or foreign session (%s)', async mode => {
    await mount(); await adopt(); const gen = auth.sessionGeneration();
    if (mode === 'drop') await act(async () => { await auth.signOut(); }); else if (mode === 'B') await adopt('B');
    await expect(auth.adoptSession(session(mode === 'wrong-user' ? 'B' : 'A', 2), gen)).rejects.toMatchObject({ code: 'account_changed' });
    expect(writeRefreshToken).not.toHaveBeenCalledWith('A-2');
});
test('email sign-in finishing after a winning sign-in is cancelled without analytics or revocation', async () => {
    await mount(); const gate = deferred<Session>(); jest.mocked(signInWithPassword).mockReturnValueOnce(gate.promise).mockResolvedValueOnce(session('B'));
    let a!: Promise<void>; await act(async () => { a = auth.signInWithEmail('a', 'p', 'c'); });
    await act(async () => { await auth.signInWithEmail('b', 'p', 'c'); }); jest.mocked(captureEvent).mockClear();
    await act(async () => { gate.resolve(session('A')); await a; });
    expect(await a).toBeUndefined(); expect(captureEvent).not.toHaveBeenCalled(); expect(revokeSession).not.toHaveBeenCalled(); expect(await auth.getAccessToken()).toBe(jwt('B'));
});
test.each(['refresh', 'signin'])('superseded %s adopt cancels without dropping B', async mode => {
    await mount(); await adopt(); const gate = deferred(); jest.mocked(bindCacheUser).mockReturnValueOnce(gate.promise);
    jest.mocked(refreshSession).mockResolvedValueOnce(session('A', 1)); jest.mocked(signInWithPassword).mockResolvedValueOnce(session('A', 1));
    let a!: Promise<any>; await act(async () => { a = mode === 'refresh' ? auth.getAccessToken(true) : auth.signInWithEmail('a', 'p', 'c'); });
    await adopt('B'); jest.mocked(captureEvent).mockClear(); await act(async () => { gate.resolve(); await a; });
    expect(await a).toBe(mode === 'refresh' ? null : undefined); expect(clearRefreshToken).not.toHaveBeenCalled(); expect(wipeCache).not.toHaveBeenCalled(); expect(captureEvent).not.toHaveBeenCalled();
    jest.mocked(refreshSession).mockResolvedValueOnce(session('B', 1)); await act(async () => { await auth.getAccessToken(true); }); expect(refreshSession).toHaveBeenLastCalledWith('B-0');
});
test.each([false, true])('stale expected generation refuses token lookup before refreshing (force=%s)', async force => {
    await mount(); await adopt(); const gen = auth.generation; await adopt('B');
    await expect(auth.getAccessToken(force, gen)).rejects.toMatchObject({ code: 'account_changed' }); expect(refreshSession).not.toHaveBeenCalled();
});
test.each([false, true])('A account call does not refresh or resend B (switch during refresh=%s)', async duringRefresh => {
    await mount(); await adopt(); const first = deferred<Response>(), refresh = deferred<Session>();
    send.mockReturnValueOnce(first.promise); jest.mocked(refreshSession).mockReturnValueOnce(refresh.promise);
    let result!: Promise<any>; await act(async () => { result = changePassword(auth.getAccessToken, 'p', 'c').catch(e => e); });
    if (duringRefresh) await act(async () => { first.resolve(response(401)); });
    await adopt('B'); await act(async () => { if (duringRefresh) refresh.resolve(session('A', 1)); else first.resolve(response(401)); await result; });
    expect(await result).toMatchObject({ code: 'account_changed' }); expect(send).toHaveBeenCalledTimes(1);
    expect(refreshSession).toHaveBeenCalledTimes(duringRefresh ? 1 : 0); expect(clearRefreshToken).not.toHaveBeenCalled(); expect(await auth.getAccessToken()).toBe(jwt('B'));
});
test.each(['request', 'stream'] as const)('A %s waiting for consent cannot refresh expiring B', async method => {
    await mount(); await adopt(); const gate = deferred(); jest.mocked(aiConsent.ensure).mockReturnValueOnce(gate.promise);
    let result!: Promise<any>; await act(async () => { result = auth.api[method]('/api/v1/generations', { method: 'POST' }).catch(e => e); });
    await act(async () => { await auth.signOut(); await auth.adoptSession({ ...session('B'), expiresAt: Date.now() + 1000 }); });
    jest.mocked(refreshSession).mockRejectedValueOnce(new AuthError(401, 'rejected')); jest.mocked(clearRefreshToken).mockClear(); jest.mocked(wipeCache).mockClear();
    await act(async () => { gate.resolve(); await result; });
    expect(await result).toMatchObject({ code: 'account_changed' }); expect(refreshSession).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(streamFetch).not.toHaveBeenCalled();
    expect(clearRefreshToken).not.toHaveBeenCalled(); expect(wipeCache).not.toHaveBeenCalled(); expect(auth.status).toBe('signedIn'); expect(auth.beginSessionTask().user).toBe('B');
});
test('stale signOut and onSessionLost are no-ops; current and unqualified signOut still work', async () => {
    await mount(); await adopt(); const gen = auth.generation; await adopt('B');
    await act(async () => { await auth.signOut(gen); auth.onSessionLost(gen); });
    expect(clearRefreshToken).not.toHaveBeenCalled(); expect(revokeSession).not.toHaveBeenCalled(); expect(wipeCache).not.toHaveBeenCalled();
    await act(async () => { await auth.signOut(auth.generation); }); expect(auth.status).toBe('signedOut');
    await adopt(); await act(async () => { auth.onSessionLost(); }); expect(auth.status).toBe('signedOut');
    await adopt(); await act(async () => { await auth.signOut(); }); expect(auth.status).toBe('signedOut');
});
test('same-user refresh and step-up keep both rendered generation and task current', async () => {
    await mount(); expect(auth.beginSessionTask().user).toBeNull(); await adopt(); const task = auth.beginSessionTask();
    jest.mocked(refreshSession).mockResolvedValueOnce(session('A', 1)); await act(async () => { await auth.getAccessToken(true); await auth.adoptSession(session('A', 2), task.gen); });
    expect(task.current()).toBe(true); expect(auth.generation).toBe(task.gen); expect(task.user).toBe('A');
    await adopt('B'); expect(task.current()).toBe(false); await expect(task.tokens()).rejects.toMatchObject({ code: 'account_changed' });
});
test.each(['B', 'drop'])('MFA step-up paused inside adopt cannot mark A cleared after %s', async target => {
    const factors = [{ id: 'factor', status: 'verified', factor_type: 'totp' }];
    send.mockImplementation(async (url: string) => url.endsWith('/user') ? response(200, { factors }) :
        url.endsWith('/challenge') ? response(200, { id: 'challenge' }) : response(200, { access_token: jwt('A', 1, 'aal2'), refresh_token: 'step-up', expires_in: 3600 }));
    await mount(<MfaGate><RN.Text>Inside</RN.Text></MfaGate>); await adopt();
    const field = root.container.queryAll(n => n.props.onChangeText)[0];
    await act(async () => field.props.onChangeText('123456'));
    const gate = deferred(); jest.mocked(writeRefreshToken).mockReturnValueOnce(gate.promise);
    await press(t('acct.mfa.verify')); expect(writeRefreshToken).toHaveBeenLastCalledWith('step-up');
    if (target === 'B') await adopt('B'); else await act(async () => { await auth.signOut(); });
    await act(async () => { gate.resolve(); await tick(); });
    expect(mfaClearedFor('A')).toBe(false); expect(texts('Inside')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert')).toHaveLength(0);
    expect(auth.status).toBe(target === 'B' ? 'signedIn' : 'signedOut');
    if (target === 'B') { expect(writeRefreshToken).toHaveBeenLastCalledWith('B-0'); expect(await auth.getAccessToken()).toBe(jwt('B')); }
});
