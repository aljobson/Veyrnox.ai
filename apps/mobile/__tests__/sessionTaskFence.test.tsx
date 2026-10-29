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
import * as calls from '../src/lib/auth/accountCalls';
import * as mfa from '../src/lib/mfaCheck';
import { MfaCard } from '../src/components/account/MfaCard';
import { MfaGate } from '../src/components/account/MfaGate';
import { PasskeysCard } from '../src/components/account/PasskeysCard';
import { createCredential } from '../src/lib/auth/passkeyNative';
import { usePush } from '../src/push/pushContext';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import OAuthConsent from '../src/app/(app)/oauth-consent';
import PrivacyExport from '../src/app/(app)/privacy-export';
import Account from '../src/app/(app)/account';
import { decide, fetchRequest } from '../src/lib/oauthConsent';
import { runVibeIntent } from '../src/lib/creatorProfileStore';
import { ApiError } from '../src/lib/api';
import { runExport } from '../src/lib/privacyExport';
declare const require: (id: string) => any;
const { PushProviderLive } = require('../src/push/PushProviderLive') as typeof import('../src/push/PushProviderLive');
jest.mock('../src/lib/auth/passkeyNative', () => ({ ...jest.requireActual('../src/lib/auth/passkeyNative'), nativePasskeysSupported: () => true, createCredential: jest.fn() }));
jest.mock('../src/lib/push', () => ({ ...jest.requireActual('../src/lib/push'), PUSH_ENABLED: true }));
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), getPermissionsAsync: jest.fn(async () => ({ granted: true })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })), getExpoPushTokenAsync: jest.fn(), getLastNotificationResponseAsync: jest.fn(async () => null),
    addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'project' } } } } }));
const mockStorage = new Map<string, string>();
jest.mock('expo-secure-store', () => ({ getItem: jest.fn(() => null), getItemAsync: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }) }));
const mockRouter = { replace: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useRouter: () => mockRouter,
    useFocusEffect: (fn: any) => require('react').useEffect(fn, [fn]),
    useLocalSearchParams: () => ({ authorization_id: '00000000-0000-4000-8000-000000000001' }) }));
jest.mock('../src/lib/oauthConsent', () => ({ ...jest.requireActual('../src/lib/oauthConsent'), decide: jest.fn(), fetchRequest: jest.fn() }));
jest.mock('../src/lib/creatorProfile', () => ({ ...jest.requireActual('../src/lib/creatorProfile'), CREATOR_PROFILE_ENABLED: true, fetchVibeStatus: jest.fn(async () => ({ kind: 'none' })) }));
jest.mock('../src/lib/creatorProfileStore', () => ({ clearVibe: jest.fn(async () => { mockStorage.delete('veyrnox.vibe.v2'); }), clearAllVibes: jest.fn(async () => {}), runVibeIntent: jest.fn() }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => ({ status: 'off', refreshSales: jest.fn() }) }));
jest.mock('../src/lib/privacyExport', () => ({ ...jest.requireActual('../src/lib/privacyExport'), runExport: jest.fn() }));

let push: ReturnType<typeof usePush>;
function PushProbe() { push = usePush(); return null; }
function Keyed({ children }: { children: ReactNode }) { const { generation } = useAuth(); return <RN.View key={generation}>{children}</RN.View>; }
beforeEach(() => {
    mfa.forgetMfaCleared(); mockStorage.clear(); mockStorage.set('veyrnox_push_pref', 'on');
    calls.resetProfileGuard();
    jest.mocked(Notifications.getExpoPushTokenAsync).mockReset().mockResolvedValueOnce({ data: 'ExpoPushToken[A]', type: 'expo' }).mockResolvedValue({ data: 'ExpoPushToken[B]', type: 'expo' });
    send.mockImplementation(async () => response(200, { factors: [], notify_jobs: true }));
});
test('session task captures gen and user, survives same-user refresh, and invalidates on switch', async () => {
    await mount(); expect(auth.beginSessionTask().user).toBeNull(); await adopt(); const task = auth.beginSessionTask();
    expect(task).toMatchObject({ gen: auth.generation, user: 'A' }); expect(task.tokens.expected).toBe(task.gen);
    jest.mocked(refreshSession).mockResolvedValueOnce(session('A', 1)); await act(async () => { await auth.getAccessToken(true); });
    expect(task.current()).toBe(true); await switchToB(); expect(task.current()).toBe(false);
    await expect(task.tokens()).rejects.toMatchObject({ code: 'account_changed' });
});
test('MfaCard stale profile records no enrolment and reads no new token; offline B stays closed', async () => {
    await mount(); await adopt(); const gate = deferred<calls.Profile>(), remember = jest.spyOn(mfa, 'rememberMfaEnrolment');
    jest.spyOn(calls, 'fetchProfile').mockReturnValueOnce(gate.promise).mockRejectedValue(new AuthError(0, 'network'));
    mockStorage.set('veyrnox_mfa_enrolled_B', '1');
    const task = auth.beginSessionTask(), tokenCalls = jest.fn(task.tokens);
    jest.spyOn(auth, 'beginSessionTask').mockReturnValue({ ...task, tokens: tokenCalls });
    await act(async () => root.render(<AuthProvider><Probe /><Keyed><MfaCard /></Keyed></AuthProvider>));
    await switchToB(); remember.mockClear();
    await act(async () => gate.resolve({ email: 'A', provider: 'email', factors: [] }));
    expect(remember).not.toHaveBeenCalled(); expect(tokenCalls).not.toHaveBeenCalled(); expect(mockStorage.get('veyrnox_mfa_enrolled_B')).toBe('1');
    await act(async () => root.render(<AuthProvider><Probe /><MfaGate><RN.Text>Inside</RN.Text></MfaGate></AuthProvider>));
    expect(texts('Inside')).toHaveLength(0); expect(texts(t('acct.mfa.unavailable'))).toHaveLength(1);
});
test('same-account MFA card load remembers enrolment under its captured user', async () => {
    await mount(); await adopt(); const remember = jest.spyOn(mfa, 'rememberMfaEnrolment');
    await act(async () => root.render(<AuthProvider><Probe /><MfaCard /></AuthProvider>));
    expect(remember).toHaveBeenCalledWith('A', false);
});
test('MfaGate profile finishing after switch does not clear or remember either user for A task', async () => {
    await mount(); await adopt(); const gate = deferred<calls.Profile>();
    jest.spyOn(calls, 'fetchProfile').mockReturnValueOnce(gate.promise).mockRejectedValue(new AuthError(0, 'network'));
    const remember = jest.spyOn(mfa, 'rememberMfaEnrolment'), cleared = jest.spyOn(mfa, 'markMfaCleared');
    await act(async () => root.render(<AuthProvider><Probe /><MfaGate><RN.Text>Inside</RN.Text></MfaGate></AuthProvider>));
    await switchToB(); await act(async () => gate.resolve({ email: 'A', provider: 'email', factors: [] }));
    expect(remember).not.toHaveBeenCalled(); expect(cleared).not.toHaveBeenCalled();
});
test.each(['unregister', 'disable'] as const)('A pending push %s cannot clear B registration or pref', async mode => {
    await mount(<PushProviderLive><PushProbe /><Account /></PushProviderLive>); await adopt();
    const gate = deferred<Response>(), original = send.getMockImplementation()!;
    send.mockImplementation((url, init) => url.endsWith('/devices') && init.method === 'DELETE' && init.headers.Authorization === `Bearer ${jwt('A')}` ? gate.promise : original(url, init));
    let done!: Promise<any>; await act(async () => { done = mode === 'unregister' ? push.unregister() : push.setEnabled(false); });
    await switchToB(); jest.mocked(SecureStore.setItemAsync).mockClear();
    await act(async () => { gate.resolve(response()); await done; });
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); if (mode === 'disable') expect(await done).toBe('unavailable');
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {}); await press(t('public.account.signOut'));
    await act(async () => { alert.mock.calls.at(-1)![2]!.find(b => b.style === 'destructive')!.onPress!(); });
    const removals = send.mock.calls.filter(([url, init]) => url.endsWith('/devices') && init.method === 'DELETE' && init.headers.Authorization === `Bearer ${jwt('B')}`);
    expect(removals).toHaveLength(1); expect(JSON.parse(removals[0][1].body).token).toBe('ExpoPushToken[B]');
});
test('setEnabled true finishing after switch writes no preference', async () => {
    await mount(<PushProviderLive><PushProbe /></PushProviderLive>); await adopt();
    const gate = deferred<any>(); jest.mocked(Notifications.requestPermissionsAsync).mockReturnValueOnce(gate.promise);
    let done!: Promise<any>; await act(async () => { done = push.setEnabled(true); }); await switchToB(); jest.mocked(SecureStore.setItemAsync).mockClear();
    await act(async () => { gate.resolve({ granted: true }); await done; }); expect(await done).toBe('unavailable'); expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
test('addPasskey platform prompt resolving after B sends no verification and never refreshes B', async () => {
    process.env.EXPO_PUBLIC_PASSKEYS_IOS_ENABLED = 'true'; process.env.EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED = 'true';
    await mount(); await adopt(); await act(async () => root.render(<AuthProvider><Probe /><PasskeysCard /></AuthProvider>));
    const gate = deferred<any>(); jest.mocked(createCredential).mockReturnValueOnce(gate.promise);
    send.mockClear().mockResolvedValue(response(200, { challenge_id: 'challenge', options: { challenge: 'c', rp: { id: 'example.test' }, user: { id: 'A' } } }));
    await press(t('passkey.add')); expect(createCredential).toHaveBeenCalledTimes(1);
    await act(async () => { await auth.adoptSession({ ...session('B'), expiresAt: Date.now() + 1000 }); });
    jest.mocked(refreshSession).mockRejectedValueOnce(new AuthError(401, 'rejected'));
    await act(async () => gate.resolve({ id: 'id', rawId: 'raw', response: { clientDataJSON: 'data' } }));
    expect(send).toHaveBeenCalledTimes(1); expect(refreshSession).not.toHaveBeenCalled(); expect(auth.status).toBe('signedIn'); expect(auth.beginSessionTask().user).toBe('B');
});
test('privacy-export stale profile sends no verifyFactor', async () => {
    await mount(); await adopt(); jest.mocked(runExport).mockRejectedValueOnce(new ApiError(403, 'mfa_required'));
    await act(async () => root.render(<AuthProvider><Probe /><PrivacyExport /></AuthProvider>)); await press(t('privacyExport.prepare'));
    const gate = deferred<calls.Profile>(); jest.spyOn(calls, 'fetchProfile').mockReturnValueOnce(gate.promise); const verify = jest.spyOn(calls, 'verifyFactor');
    const field = root.container.queryAll(n => n.props.onChangeText)[0]; await act(async () => field.props.onChangeText('123456')); await press(t('privacyExport.verify'));
    await switchToB(); await act(async () => gate.resolve({ email: 'A', provider: 'email', factors: [{ id: 'f', status: 'verified', friendlyName: 'auth' }] }));
    expect(verify).not.toHaveBeenCalled(); expect(texts(t('privacyExport.codeError'))).toHaveLength(0);
});
test('oauth consent decided after switch opens no URL and does not navigate', async () => {
    jest.mocked(fetchRequest).mockResolvedValue({ name: 'Assistant', scopes: [] } as any); const gate = deferred<string>(); jest.mocked(decide).mockReturnValueOnce(gate.promise);
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue();
    await mount(<OAuthConsent />); await adopt(); await press(t('oauth.approve')); await switchToB(); await act(async () => gate.resolve('https://a.test'));
    expect(open).not.toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled();
});
test('vibe reset finishing after switch does not clear B device slot or show note', async () => {
    const gate = deferred<any>(); jest.mocked(runVibeIntent).mockReturnValueOnce(gate.promise); await mount(<Account />); await adopt();
    const label = t('vibe.account.reset');
    const contains = (node: any): boolean => node.children?.some((child: any) => typeof child === 'string' ? child === label : contains(child));
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && contains(n))[0];
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(runVibeIntent).toHaveBeenCalledTimes(1);
    const started = jest.mocked(runVibeIntent).mock.calls[0][1];
    expect(started.user).toBe('A'); await switchToB(); expect(started.current()).toBe(false);
    const bRecord = JSON.stringify({ owner: 'B', value: JSON.stringify({ version: 1, state: 'skipped', answers: null, synced: true }) });
    mockStorage.set('veyrnox.vibe.v2', bRecord); jest.mocked(SecureStore.setItemAsync).mockClear();
    await act(async () => gate.resolve({ kind: 'applied', result: 'ok' }));
    expect(mockStorage.get('veyrnox.vibe.v2')).toBe(bRecord); expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(texts(t('vibe.account.resetDone'))).toHaveLength(0); expect(texts(t('vibe.error'))).toHaveLength(0);
});
test('MfaGate token refresh crossing a switch cannot remember or clear the new user', async () => {
    await mount(); await adopt();
    await act(async () => { await auth.adoptSession({ ...session('A'), expiresAt: Date.now() + 1000 }, auth.generation); });
    const gate = deferred<Session>(); jest.mocked(refreshSession).mockReturnValueOnce(gate.promise);
    jest.spyOn(calls, 'fetchProfile').mockResolvedValueOnce({ email: 'A', provider: 'email', factors: [] }).mockRejectedValue(new AuthError(0, 'network'));
    const remember = jest.spyOn(mfa, 'rememberMfaEnrolment'), cleared = jest.spyOn(mfa, 'markMfaCleared');
    await act(async () => root.render(<AuthProvider><Probe /><MfaGate><RN.Text>Inside</RN.Text></MfaGate></AuthProvider>));
    expect(refreshSession).toHaveBeenCalledWith('A-0'); await switchToB();
    await act(async () => gate.resolve(session('A', 1)));
    expect(remember).not.toHaveBeenCalled(); expect(cleared).not.toHaveBeenCalled(); expect(auth.beginSessionTask().user).toBe('B');
});
