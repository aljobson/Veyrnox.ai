jest.mock('../src/lib/crash', () => ({ captureIssue: jest.fn() }));
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
import { DevicesCard } from '../src/components/account/DevicesCard';
import DeleteAccount from '../src/app/(app)/delete-account';
import Account from '../src/app/(app)/account';
import { EditorSpikeHarness } from '../src/components/dev/EditorSpikeHarness';
import { confirmDeletion, prepareDeletion } from '../src/lib/accountDeletion';
import { revokeSessions } from '../src/lib/auth/accountCalls';
import { ApiError } from '../src/lib/api';
import FaceFiltersScreen from '../src/app/(app)/face-filters';
jest.mock('../src/lib/auth/accountCalls', () => ({ ...jest.requireActual('../src/lib/auth/accountCalls'), revokeSessions: jest.fn() }));
jest.mock('../src/lib/accountDeletion', () => ({ prepareDeletion: jest.fn(), confirmDeletion: jest.fn(), blockerText: (s: string) => s }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => ({ status: 'off' }) }));
const mockPush = { unregister: jest.fn(async () => {}), setEnabled: jest.fn(), supported: false };
jest.mock('../src/push/pushContext', () => ({ usePush: () => mockPush }));
const mockRouter = { replace: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useRouter: () => mockRouter }));
jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
let mockFaceApi: ReturnType<typeof useAuth>['api'];
jest.mock('../src/components/FaceFiltersFlow', () => ({ FaceFiltersFlow: ({ api }: any) => { mockFaceApi = api; return null; } }));

beforeEach(() => {
    jest.mocked(prepareDeletion).mockResolvedValue({ kind: 'ready', token: 'delete-token', forfeit: { credits: 0, freeCredits: 0 } });
    jest.mocked(confirmDeletion).mockResolvedValue({ kind: 'deleted' });
    mockPush.unregister.mockResolvedValue();
});
async function confirmButton(label: string) {
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {}); await press(label);
    await act(async () => { alert.mock.calls.at(-1)![2]!.find(b => b.style === 'destructive')!.onPress!(); });
}
async function erase() {
    const input = root.container.queryAll(n => n.props.onChangeText)[0]; await act(async () => input.props.onChangeText('DELETE'));
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.children.some(c => typeof c !== 'string' && c.children?.includes(t('deleteaccount.deletemyaccount'))))[0];
    // This legacy screen labels the child Text, rather than accessibilityLabel.
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
test.each(['global', 'others'] as const)('DevicesCard %s finishing after B neither signs out B nor shows a note', async scope => {
    const gate = deferred(); jest.mocked(revokeSessions).mockImplementationOnce(async tokens => { expect(await tokens()).toBe(jwt('A')); await gate.promise; });
    await mount(<DevicesCard />); await adopt(); await confirmButton(t(scope === 'global' ? 'acct.dev.everywhere' : 'acct.dev.others'));
    await adopt('B'); await act(async () => gate.resolve());
    expect(clearRefreshToken).not.toHaveBeenCalled(); expect(revokeSession).not.toHaveBeenCalled(); expect(await auth.getAccessToken()).toBe(jwt('B'));
    expect(texts(t('acct.dev.othersDone'))).toHaveLength(0); expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert')).toHaveLength(0);
});
test('same-account global revoke still signs out once', async () => {
    jest.mocked(revokeSessions).mockResolvedValueOnce(); await mount(<DevicesCard />); await adopt(); await confirmButton(t('acct.dev.everywhere'));
    expect(auth.status).toBe('signedOut'); expect(revokeSession).toHaveBeenCalledTimes(1);
});
test('deletion finishing after B neither signs out B nor navigates', async () => {
    const gate = deferred<any>(); jest.mocked(confirmDeletion).mockReturnValueOnce(gate.promise);
    await mount(<DeleteAccount />); await adopt(); await erase(); await adopt('B'); await act(async () => gate.resolve({ kind: 'deleted' }));
    expect(mockRouter.replace).not.toHaveBeenCalled(); expect(clearRefreshToken).not.toHaveBeenCalled(); expect(revokeSession).not.toHaveBeenCalled(); expect(await auth.getAccessToken()).toBe(jwt('B'));
});
test.each(['success', 'clear-failed', 'B-during-revoke'])('deletion navigation respects its own sign-out generation (%s)', async mode => {
    await mount(<DeleteAccount />); await adopt(); const gate = deferred();
    if (mode === 'clear-failed') jest.mocked(clearRefreshToken).mockRejectedValueOnce(new Error('disk'));
    else jest.mocked(revokeSession).mockReturnValueOnce(gate.promise);
    await erase();
    if (mode === 'B-during-revoke') await adopt('B');
    await act(async () => gate.resolve());
    if (mode === 'B-during-revoke') { expect(mockRouter.replace).not.toHaveBeenCalled(); expect(await auth.getAccessToken()).toBe(jwt('B')); }
    else expect(mockRouter.replace.mock.calls).toEqual([['/sign-in']]);
});
test('Account sign-out whose push unregister finishes after B leaves B signed in', async () => {
    const gate = deferred(); mockPush.unregister.mockReturnValueOnce(gate.promise);
    await mount(<Account />); await adopt(); await confirmButton(t('public.account.signOut')); await adopt('B'); await act(async () => gate.resolve());
    expect(revokeSession).not.toHaveBeenCalled(); expect(clearRefreshToken).not.toHaveBeenCalled(); expect(await auth.getAccessToken()).toBe(jwt('B'));
});
test('EditorSpikeHarness stale forced token is not handed to the page', async () => {
    await mount(); await adopt(); const gate = deferred<Session>(); jest.mocked(refreshSession).mockReturnValueOnce(gate.promise);
    await act(async () => root.render(<AuthProvider><Probe /><EditorSpikeHarness /></AuthProvider>));
    await adopt('B'); await act(async () => gate.resolve(session('A', 1)));
    expect(root.container.queryAll(n => typeof n.props.injectedJavaScriptBeforeContentLoaded === 'string' && n.props.injectedJavaScriptBeforeContentLoaded.includes(jwt('A', 1)))).toHaveLength(0);
});
test.each(['request', 'stream'] as const)('Face filters %s consent delay cannot refresh or drop expiring B', async method => {
    await mount(<FaceFiltersScreen />); await adopt(); const gate = deferred(); jest.mocked(aiConsent.ensure).mockReturnValueOnce(gate.promise);
    let result!: Promise<any>; await act(async () => { result = mockFaceApi[method]('/api/v1/generations', { method: 'POST' }).catch(e => e); });
    await act(async () => { await auth.signOut(); await auth.adoptSession({ ...session('B'), expiresAt: Date.now() + 1000 }); });
    jest.mocked(refreshSession).mockRejectedValueOnce(new AuthError(401, 'rejected')); jest.mocked(clearRefreshToken).mockClear(); jest.mocked(wipeCache).mockClear();
    await act(async () => { gate.resolve(); await result; });
    expect(await result).toBeInstanceOf(ApiError); expect(await result).toMatchObject({ code: 'account_changed' });
    expect(send).not.toHaveBeenCalled(); expect(streamFetch).not.toHaveBeenCalled(); expect(refreshSession).not.toHaveBeenCalled(); expect(clearRefreshToken).not.toHaveBeenCalled(); expect(wipeCache).not.toHaveBeenCalled();
    expect(auth.status).toBe('signedIn'); expect(auth.beginSessionTask().user).toBe('B');
});
