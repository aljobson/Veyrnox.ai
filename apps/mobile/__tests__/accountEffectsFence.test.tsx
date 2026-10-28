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
import Purchases from 'react-native-purchases';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { usePush } from '../src/push/pushContext';
import { LanguageGate } from '../src/components/LanguageGate';
import { syncPendingAccountLanguage } from '../src/lib/languageStore';
import { forgetMfaCleared } from '../src/lib/mfaCheck';
import AppLayout from '../src/app/(app)/_layout';
import { captureEvent as billingEvent } from '../src/lib/analytics/events';

declare const require: (id: string) => any;
process.env.EXPO_PUBLIC_STORE_BILLING_ENABLED = 'true'; process.env.EXPO_PUBLIC_REVENUECAT_TEST_KEY = 'test';
const { BillingProvider, useBilling } = require('../src/billing/BillingProvider') as typeof import('../src/billing/BillingProvider');
const { PushProviderLive } = require('../src/push/PushProviderLive') as typeof import('../src/push/PushProviderLive');
jest.mock('react-native-purchases', () => ({ __esModule: true, default: { configure: jest.fn(), addCustomerInfoUpdateListener: jest.fn(),
    getOfferings: jest.fn(async () => ({ all: {} })), logIn: jest.fn(), logOut: jest.fn(async () => {}), getCustomerInfo: jest.fn(),
    purchasePackage: jest.fn(), restorePurchases: jest.fn() } }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: jest.fn() }));
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn(), getPermissionsAsync: jest.fn(async () => ({ granted: true })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })), getExpoPushTokenAsync: jest.fn(), getLastNotificationResponseAsync: jest.fn(async () => null),
    addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'project' } } } } }));
jest.mock('../src/lib/push', () => ({ ...jest.requireActual('../src/lib/push'), PUSH_ENABLED: true }));
jest.mock('expo-secure-store', () => ({ getItem: jest.fn(() => null), getItemAsync: jest.fn(async (key: string) => key === 'veyrnox_push_pref' ? 'on' : null), setItemAsync: jest.fn(async () => {}) }));
const mockRouter = { replace: jest.fn(), push: jest.fn() };
let mockScreenLoads = 0;
function MockScreen() { const { api } = useAuth(); require('react').useEffect(() => { mockScreenLoads++; void api.request('/screen'); }, [api]); return <RN.Text>Screen</RN.Text>; }
jest.mock('expo-router', () => ({ Stack: Object.assign(() => <MockScreen />, { Screen: () => null }), Redirect: () => null,
    useRouter: () => mockRouter, usePathname: () => '/account', useSegments: () => [], useGlobalSearchParams: () => ({}) }));
jest.mock('../src/lib/languageDirection', () => ({ directionReconciler: { takeReturnPath: () => null, handledRepair: () => false }, languageReturnPath: () => '/account', reconcileLanguageDirection: jest.fn(async () => true) }));
jest.mock('../src/lib/languageStore', () => ({ readLanguage: () => 'en', syncPendingAccountLanguage: jest.fn(async () => {}) }));
jest.mock('../src/components/LanguageChoice', () => ({ LanguageChoice: () => null }));
jest.mock('../src/components/ErrorFallback', () => ({ SignedInErrorBoundary: () => null }));
jest.mock('../src/lib/useOfflineRecovery', () => ({ useOfflineRecovery: () => {} }));
jest.mock('../src/components/FirstRunGate', () => ({ FirstRunGate: () => null }));
jest.mock('../src/components/CheckInModal', () => ({ CheckInModal: () => null }));
jest.mock('../src/components/PaywallPrompt', () => ({ PaywallPrompt: () => null }));
jest.mock('../src/components/CelebrationHost', () => ({ CelebrationHost: () => null }));
jest.mock('../src/components/AiConsentHost', () => ({ AiConsentHost: () => null }));

const info = (active = false): any => ({ entitlements: { active: active ? { publish: {}, generation: {} } : {} }, activeSubscriptions: active ? ['A-plan'] : [], managementURL: active ? 'https://a.test' : null });
let billing: ReturnType<typeof useBilling>, push: ReturnType<typeof usePush>;
function BillingProbe() { billing = useBilling(); return null; }
function PushProbe() { push = usePush(); return null; }
async function bill() { await mount(<BillingProvider><BillingProbe /></BillingProvider>); await adopt(); }
async function pushes() { await mount(<PushProviderLive><PushProbe /></PushProviderLive>); await adopt(); }
beforeEach(() => {
    forgetMfaCleared(); mockScreenLoads = 0;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.mocked(Purchases.logIn).mockImplementation(async () => ({ customerInfo: info() }) as any);
    jest.mocked(Purchases.getCustomerInfo).mockResolvedValue(info());
    jest.mocked(Notifications.getExpoPushTokenAsync).mockReset().mockResolvedValueOnce({ data: 'ExpoPushToken[A]', type: 'expo' }).mockResolvedValue({ data: 'ExpoPushToken[B]', type: 'expo' });
    send.mockImplementation(async (url: string, init: RequestInit) => {
        const a = (init.headers as any).Authorization === `Bearer ${jwt('A')}`;
        if (url.includes('/store-purchases/customer')) return response(200, { rc_customer_id: a ? 'rc-A' : 'rc-B' });
        if (url.includes('/subscriptions')) return response(200, { subscription: a ? { status: 'active' } : null });
        if (url.includes('/social/plan')) return response(200, { entitlement: { tier: a ? 'publish' : 'free' } });
        return response(200, { notify_jobs: true, factors: [] });
    });
});
test.each([false, true])('billing binds B with continuously signedIn status (A pending=%s)', async pending => {
    const a = deferred<any>(); if (pending) jest.mocked(Purchases.logIn).mockReturnValueOnce(a.promise);
    await bill(); if (!pending) expect(billing.canPurchase).toBe(true);
    const b = deferred<any>(); jest.mocked(Purchases.logIn).mockReturnValueOnce(b.promise);
    await switchToB(); expect(billing.canPurchase).toBe(false); expect(billing.publishActive).toBe(false);
    if (pending) { expect(Purchases.logIn).toHaveBeenCalledTimes(1); await act(async () => a.resolve({ customerInfo: info(true) })); }
    expect(Purchases.logIn).toHaveBeenLastCalledWith('rc-B');
    await act(async () => b.resolve({ customerInfo: info() })); expect(billing.canPurchase).toBe(true); expect(billing.activeProductIds).toEqual([]);
    const calls = send.mock.calls.filter(([url]) => url.includes('/store-purchases/customer'));
    expect(calls).toHaveLength(2); expect(calls[1][1].headers.Authorization).toBe(`Bearer ${jwt('B')}`);
});
test('customer id arriving after a switch never logs in A', async () => {
    const a = deferred<Response>(), original = send.getMockImplementation()!;
    send.mockImplementation((url, init) => url.includes('/store-purchases/customer') && init.headers.Authorization === `Bearer ${jwt('A')}` ? a.promise : original(url, init));
    await bill(); await switchToB(); await act(async () => a.resolve(response(200, { rc_customer_id: 'rc-A' })));
    expect(jest.mocked(Purchases.logIn).mock.calls).toEqual([['rc-B']]);
});
test('late login is followed by logout when signed out', async () => {
    const a = deferred<any>(); jest.mocked(Purchases.logIn).mockReturnValueOnce(a.promise); await bill();
    await act(async () => { await auth.signOut(); }); expect(Purchases.logOut).not.toHaveBeenCalled();
    await act(async () => a.resolve({ customerInfo: info(true) })); expect(Purchases.logOut).toHaveBeenCalledTimes(1); expect(billing.canPurchase).toBe(false);
});
test('server access is fetched again for B and A entitlements disappear', async () => {
    await bill(); expect(billing.publishActive).toBe(true); await switchToB(); expect(billing.publishActive).toBe(false); expect(billing.generationActive).toBe(false);
    for (const path of ['/subscriptions', '/social/plan']) expect(send.mock.calls.filter(([url]) => url.includes(path))).toHaveLength(2);
});
test('A CustomerInfo event after B binds re-reads B instead of writing the event payload', async () => {
    await bill(); await switchToB(); const listener = jest.mocked(Purchases.addCustomerInfoUpdateListener).mock.calls[0][0];
    await act(async () => listener(info(true))); expect(Purchases.getCustomerInfo).toHaveBeenCalledTimes(1);
    expect(billing.publishActive).toBe(false); expect(billing.activeProductIds).toEqual([]);
});
test('an event while unbound writes nothing', async () => {
    await mount(<BillingProvider><BillingProbe /></BillingProvider>); const listener = jest.mocked(Purchases.addCustomerInfoUpdateListener).mock.calls[0][0];
    await act(async () => listener(info(true))); expect(Purchases.getCustomerInfo).not.toHaveBeenCalled(); expect(billing.publishActive).toBe(false);
});
test.each(['purchase', 'restore'] as const)('%s finishing after switch writes no A state or finished analytics', async action => {
    await bill(); const gate = deferred<any>();
    if (action === 'purchase') jest.mocked(Purchases.purchasePackage).mockReturnValueOnce(gate.promise); else jest.mocked(Purchases.restorePurchases).mockReturnValueOnce(gate.promise);
    let done!: Promise<any>; await act(async () => { done = action === 'purchase' ? billing.purchase({ product: { identifier: 'pack' } } as any) : billing.restore(); });
    await switchToB(); jest.mocked(billingEvent).mockClear();
    await act(async () => { gate.resolve(action === 'purchase' ? { customerInfo: info(true) } : info(true)); await done; });
    expect(billing.activeProductIds).toEqual([]); expect(billing.publishActive).toBe(false); expect(billingEvent).not.toHaveBeenCalled();
    if (action === 'purchase') expect(await done).toBe('purchased');
});
test('B failed customer lookup leaves no A store entitlement', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {}); jest.mocked(Purchases.logIn).mockResolvedValueOnce({ customerInfo: info(true) } as any);
    await bill(); expect(billing.activeProductIds).toEqual(['A-plan']);
    const original = send.getMockImplementation()!;
    send.mockImplementation((url, init) => url.includes('/store-purchases/customer') && init.headers.Authorization === `Bearer ${jwt('B')}` ? Promise.resolve(response(500)) : original(url, init));
    await switchToB(); expect(billing).toMatchObject({ publishActive: false, generationActive: false, activeProductIds: [], managementURL: null, canPurchase: false });
});
test('push registers again for B', async () => {
    await pushes(); await switchToB(); const registrations = send.mock.calls.filter(([url, init]) => url.endsWith('/devices') && init.method === 'POST');
    expect(registrations).toHaveLength(2); expect(registrations[1][1].headers.Authorization).toBe(`Bearer ${jwt('B')}`);
});
test('A late push register does not replace B token reference', async () => {
    const gate = deferred<Response>(), original = send.getMockImplementation()!;
    send.mockImplementation((url, init) => url.endsWith('/devices') && init.method === 'POST' && init.headers.Authorization === `Bearer ${jwt('A')}` ? gate.promise : original(url, init));
    await pushes(); await switchToB(); await act(async () => gate.resolve(response(200, { notify_jobs: true })));
    await act(async () => { await push.unregister(); });
    const removes = send.mock.calls.filter(([url, init]) => url.endsWith('/devices') && init.method === 'DELETE');
    expect(removes).toHaveLength(1); expect(JSON.parse(removes[0][1].body).token).toBe('ExpoPushToken[B]');
});
test('LanguageGate syncs again for B with continuously signedIn status', async () => {
    await mount(<LanguageGate><RN.Text>Language</RN.Text></LanguageGate>); await adopt(); expect(syncPendingAccountLanguage).toHaveBeenCalledTimes(1);
    await switchToB();
    // The paused drop also renders its own generation while status is still signedIn.
    expect(syncPendingAccountLanguage).toHaveBeenCalledTimes(3);
    const boundApi = jest.mocked(syncPendingAccountLanguage).mock.calls.at(-1)![0];
    await act(async () => { await boundApi.request('/language-probe'); });
    expect(send.mock.calls.at(-1)![1].headers.Authorization).toBe(`Bearer ${jwt('B')}`);
});
test('AppLayout remounts cleared A and checks B with MFA before showing screens', async () => {
    await mount(<AppLayout />); await adopt(); expect(mockScreenLoads).toBe(1);
    const original = send.getMockImplementation()!;
    send.mockImplementation((url, init) => url.endsWith('/auth/v1/user') && init.headers.Authorization === `Bearer ${jwt('B')}` ?
        Promise.resolve(response(200, { factors: [{ id: 'f', status: 'verified', factor_type: 'totp' }] })) : original(url, init));
    await switchToB(); expect(controls(t('acct.mfa.verify'))).toHaveLength(1); expect(texts('Screen')).toHaveLength(0); expect(mockScreenLoads).toBe(1);
});
test('AppLayout screen api load runs again for B, but same-user refresh remounts nothing', async () => {
    await mount(<BillingProvider><BillingProbe /><AppLayout /></BillingProvider>); await adopt(); const gen = auth.generation;
    expect(mockScreenLoads).toBe(1); const binds = jest.mocked(Purchases.logIn).mock.calls.length;
    jest.mocked(refreshSession).mockResolvedValueOnce(session('A', 1)); await act(async () => { await auth.getAccessToken(true); });
    expect(auth.generation).toBe(gen); expect(mockScreenLoads).toBe(1); expect(Purchases.logIn).toHaveBeenCalledTimes(binds);
    await switchToB(); expect(mockScreenLoads).toBe(2);
    const loads = send.mock.calls.filter(([url]) => url.endsWith('/screen')); expect(loads[1][1].headers.Authorization).toBe(`Bearer ${jwt('B')}`);
});
