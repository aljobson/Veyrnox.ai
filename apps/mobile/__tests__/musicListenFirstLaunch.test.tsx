import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { reloadAppAsync } from 'expo';
import RootLayout from '../src/app/_layout';
import { readLanguage, saveLanguage } from '../src/lib/languageStore';
import { setLocaleFromDevice, t } from '../src/lib/i18n';
import { saveThemeReturnPath } from '../src/theme';
import { redirectSystemPath } from '../src/app/+native-intent';
import { recallPendingLink } from '../src/lib/pendingLink';
import { token, shared } from './fixtures/musicPublication';
const mockStore = new Map<string, string>(), mockWrites = jest.fn();
let mockPathname = `/music/listen/${token}`;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false };
const mockSession = { status: 'signedOut', generation: 0, api: { request: jest.fn() }, canReloadSession: () => false,
    beginSessionTask: () => ({ gen: 0, current: () => true }) };
jest.mock('expo-secure-store', () => ({
    getItem: (k: string) => mockStore.get(k) ?? null, getItemAsync: async (k: string) => mockStore.get(k) ?? null,
    setItem: (k: string, v: string) => { mockWrites(k, v); mockStore.set(k, v); },
    setItemAsync: async (k: string, v: string) => { mockWrites(k, v); mockStore.set(k, v); }, deleteItemAsync: async (k: string) => { mockStore.delete(k); },
}));
jest.mock('expo', () => ({ ...jest.requireActual('expo'), reloadAppAsync: jest.fn(async () => {}) }));
jest.mock('expo-router', () => ({
    Slot: () => mockPathname.startsWith('/music/listen/') ? jest.requireActual('react').createElement(jest.requireActual('../src/app/music/listen/[token]').default) : 'home',
    useRouter: () => mockRouter, usePathname: () => mockPathname, useSegments: () => ['music', 'listen', '[token]'],
    useGlobalSearchParams: () => ({ token: jest.requireActual('./fixtures/musicPublication').token }), useLocalSearchParams: () => ({ token: jest.requireActual('./fixtures/musicPublication').token }),
    useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(cb, [cb]),
}));
jest.mock('../src/auth/AuthProvider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children, useAuth: () => mockSession }));
jest.mock('../src/billing/BillingProvider', () => ({ BillingProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('../src/push/PushProvider', () => ({ PushProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('../src/components/AnalyticsHost', () => ({ AnalyticsHost: () => null }));
jest.mock('../src/lib/auth/discardedSession', () => ({ revokeDiscardedSession: async () => {} }));
jest.mock('../src/lib/crash', () => ({ captureIssue: jest.fn(), initCrashReporting: () => false, withCrashReporting: (component: unknown) => component }));
jest.mock('../src/components/BrandSplash', () => ({ BrandSplash: () => null }));
jest.mock('../src/components/BrandHeader', () => ({ BrandHeader: () => null }));
jest.mock('../src/components/Reveal', () => ({ Reveal: ({ children }: { children: ReactNode }) => children }));
jest.mock('../src/components/ui/FontCatalog', () => ({ typefaceFonts: { studio: {} } }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../src/lib/music/sharedListenClient', () => ({ getSharedSong: jest.fn(async () => jest.requireActual('./fixtures/musicPublication').shared.song) }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => ({ isLoaded: true, play: jest.fn(), pause: jest.fn(), remove: jest.fn(), seekTo: async () => {}, addListener: () => ({ remove: jest.fn() }) })), setAudioModeAsync: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
void [RN.View, RN.ScrollView, RN.Text, RN.Pressable];
let root: Root;
const texts = (s: string) => root.container.queryAll(n => n.children.includes(s));
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function')[0];
const render = async () => { await act(async () => root.render(<RootLayout />)); };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockStore.clear(); jest.clearAllMocks(); setLocaleFromDevice(['en']);
    mockPathname = `/music/listen/${token}`; root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); setLocaleFromDevice(['en']); });
test('fresh signed-out install defers language choice while listening, then changed language still opens the secret link', async () => {
    expect(readLanguage()).toBeNull();
    expect(await redirectSystemPath({ path: `https://veyrnox.ai/listen/${token}`, initial: true })).toBe(mockPathname);
    await render(); expect(texts(shared.song.title)).toHaveLength(1); expect(button(t('vibe.language.continue'))).toBeUndefined();
    expect(reloadAppAsync).not.toHaveBeenCalled(); expect(recallPendingLink()).toBeNull();
    // Choice and reload resume only after leaving the listen screen, as permitted by P4C-003.
    mockPathname = '/'; await render(); expect(button('Español')).toBeDefined();
    await act(async () => button('Español').props.onClick({ nativeEvent: {} }));
    await act(async () => button(t('vibe.language.continue')).props.onClick({ nativeEvent: {} }));
    expect(readLanguage()).toBe('es'); expect(reloadAppAsync).toHaveBeenCalledTimes(1);
    setLocaleFromDevice(['es']); mockPathname = await redirectSystemPath({ path: `https://veyrnox.ai/listen/${token}`, initial: true }) as string;
    await render(); expect(texts(shared.song.title)).toHaveLength(1);
    expect(mockRouter.replace).not.toHaveBeenCalled(); expect(mockRouter.push).not.toHaveBeenCalled();
    expect(JSON.stringify(mockWrites.mock.calls)).not.toContain(token);
});
test('saved theme return cannot override an incoming anonymous listen link', async () => {
    await saveLanguage('en'); await saveThemeReturnPath('/account'); await render();
    expect(texts(shared.song.title)).toHaveLength(1); expect(mockRouter.push).not.toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled();
});
test('first launch with an RTL device locale defers direction reload without storing the token', async () => {
    setLocaleFromDevice(['ar']); await render(); expect(texts(shared.song.title)).toHaveLength(1);
    expect(reloadAppAsync).not.toHaveBeenCalled(); expect(JSON.stringify(mockWrites.mock.calls)).not.toContain(token);
});
