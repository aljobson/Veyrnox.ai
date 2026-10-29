import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import * as SecureStore from 'expo-secure-store';
import { ApiError } from '../src/lib/api';
import type { SessionTask } from '../src/auth/sessionTask';
import type { CreatorAnswers } from '../src/lib/creatorAnswers';
import { bindCacheUser, getCacheUser, resetCacheUser } from '../src/lib/appCache';
import { loadVibe, runVibeIntent, storeVibe } from '../src/lib/creatorProfileStore';
import { t } from '../src/lib/i18n';
const mockDisk = new Map<string, string>();
let mockGeneration = 0;
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), setParams: jest.fn() };
const mockApi = { request: jest.fn(), getBalance: async () => ({ balance: 100 }) };
const mockTask = (): SessionTask => { const gen = mockGeneration, user = getCacheUser() ?? null; return { gen, user, current: () => gen === mockGeneration && user === (getCacheUser() ?? null), tokens: async () => null }; };
const mockFocus = new Set<() => void>();
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, generation: mockGeneration, beginSessionTask: mockTask, getAccessToken: mockTask, canReloadSession: () => true }) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async (key: string) => mockDisk.get(key) ?? null), setItemAsync: jest.fn(async (key: string, value: string) => { mockDisk.set(key, value); }), deleteItemAsync: jest.fn(async (key: string) => { mockDisk.delete(key); }) }));
jest.mock('../src/lib/creatorProfile', () => ({ ...jest.requireActual('../src/lib/creatorProfile'), CREATOR_PROFILE_ENABLED: true }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useRouter: () => mockRouter, useLocalSearchParams: () => ({}), useFocusEffect: (cb: any) => require('react').useEffect(() => { mockFocus.add(cb); const cleanup = cb(); return () => { mockFocus.delete(cb); cleanup?.(); }; }, [cb]) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/components/ui', () => {
    const component = (name: string) => ({ children, ...props }: any) => require('react').createElement(name, props, children);
    return { Text: component('text'), Card: component('card'), ListRow: component('row'), Button: component('button'), Chip: component('chip'), PriceText: component('price'), TextField: component('field'), ChoiceCard: component('choice'),
        themedStyles: (fn: any) => fn(require('../src/theme').tokensForScheme('dark'), {}), useThemedStyles: (s: any) => s, useAppearance: () => ({ scheme: 'dark' }) };
});
const answers: CreatorAnswers = { look: 'neon_rain', goal: 'story', pace: 'octopus', chaos: 2, destination: 'tiktok', audience: 'me', voice: 'calm' };
const completed = (a = answers) => ({ version: 1 as const, state: 'completed' as const, answers: a, synced: true });
function deferred<T = any>() { let resolve!: (v?: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r as any; reject = j; }); return { promise, resolve, reject }; }
const tick = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
let root: Root;
const texts = (key: string) => root.container.queryAll(n => n.type === 'text' && n.children.includes(t(key)));
const controls = (key: string) => root.container.queryAll(n => n.props.label === t(key) || n.props.title === t(key) || n.props.accessibilityLabel === t(key));
async function press(key: string) { await act(async () => { const n = controls(key).find(n => n.props.onPress || n.props.onClick)!; expect(n).toBeDefined(); (n.props.onPress ?? n.props.onClick)({ nativeEvent: {}, currentTarget: 1, target: 1 }); await tick(); }); }
async function changeOwner(owner = 'B') { await act(async () => { mockGeneration++; await bindCacheUser(owner); }); }
beforeEach(async () => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); mockDisk.clear(); mockGeneration++; resetCacheUser(); await bindCacheUser('A'); mockApi.request.mockReset().mockResolvedValue({ status: 'none' }); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
void [RN.View, RN.ScrollView, RN.KeyboardAvoidingView, RN.Pressable, RN.TextInput, RN.ActivityIndicator];
import Home from '../src/app/(app)/(tabs)/index';
import { notifyVibeIdle } from '../src/lib/vibeEvents';
jest.mock('../src/lib/media', () => ({ fetchCatalogCached: async (cb: any) => { cb([]); return []; }, mediaApi: () => ({ listJobs: async () => ({ jobs: [] }) }) }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: async () => [] }));
jest.mock('../src/lib/templateFilters', () => ({ ...jest.requireActual('../src/lib/templateFilters'), fetchPopularIds: async () => [] }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/lib/celebrate', () => ({ celebrateFinished: jest.fn() }));
jest.mock('../src/components/credits/CheckInEntry', () => ({ CheckInEntry: () => null }));
jest.mock('../src/components/home/OddlingsBanner', () => ({ OddlingsBanner: () => null }));
jest.mock('../src/components/home/StartOption', () => ({ StartOption: () => null }));
jest.mock('../src/components/home/EntryRow', () => ({ EntryRow: () => null }));
jest.mock('../src/lib/creatorTaste', () => ({ ...jest.requireActual('../src/lib/creatorTaste'), rankPresets: jest.fn((p: any) => p) }));
import { rankPresets } from '../src/lib/creatorTaste';
test.each(['none', '404', 'network'])('invite is server-confirmed: %s', async status => {
    if (status !== 'none') mockApi.request.mockRejectedValue(new ApiError(status === '404' ? 404 : 0, 'error'));
    await act(async () => root.render(<Home />)); expect(texts('vibeInvite.title')).toHaveLength(status === 'none' ? 1 : 0); expect(mockApi.request).toHaveBeenCalledTimes(1);
});
test('Not now hides immediately and calls the skip route, storing synced skipped', async () => {
    await act(async () => root.render(<Home />)); const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await press('vibeInvite.later');
    expect(texts('vibeInvite.title')).toHaveLength(0); expect(mockApi.request).toHaveBeenLastCalledWith('/api/v1/creator-profile/skip', expect.objectContaining({ method: 'POST' }), undefined);
    await act(async () => { gate.resolve({ status: 'skipped' }); await tick(); }); expect(await loadVibe()).toMatchObject({ state: 'skipped', synced: true });
});
test('kept skip with failed GET hydrates on idle without another focus event', async () => {
    mockApi.request.mockResolvedValueOnce({ status: 'none' }).mockResolvedValueOnce({ status: 'completed' }).mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValue({ status: 'completed', answers });
    await act(async () => root.render(<Home />)); await press('vibeInvite.later');
    expect(mockApi.request.mock.calls.map(c => c[1]?.method ?? 'GET')).toEqual(['GET', 'POST', 'GET', 'GET']);
    expect(await loadVibe()).toEqual(completed()); expect(texts('vibeInvite.title')).toHaveLength(0);
});
test('old Not now does not touch a new same-account session invite', async () => {
    await act(async () => root.render(<Home />)); const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await press('vibeInvite.later');
    await act(async () => { mockGeneration++; mockDisk.clear(); root.render(<Home />); });
    await act(async () => { gate.resolve({ status: 'skipped' }); await tick(); });
    expect(texts('vibeInvite.title')).toHaveLength(1); expect(controls('vibeInvite.later')[0].props.disabled).toBe(false);
});
test('Not now superseded by a finish elsewhere clears busy and keeps the new answers', async () => {
    await act(async () => root.render(<Home />)); const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await press('vibeInvite.later');
    const finish = runVibeIntent(mockApi, mockTask(), { kind: 'save', answers });
    await act(async () => { gate.resolve({ status: 'skipped' }); await finish; await tick(); });
    expect(await loadVibe()).toEqual(completed()); expect(texts('vibeInvite.title')).toHaveLength(0);
});
test('Home clears A’s loaded answers and hides invite while B’s status is pending, then loads B', async () => {
    await storeVibe(completed(), 'A'); await act(async () => root.render(<Home />)); expect(jest.mocked(rankPresets).mock.calls.at(-1)?.[1]).toEqual(answers);
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await changeOwner();
    expect(jest.mocked(rankPresets).mock.calls.at(-1)?.[1]).toBeNull(); expect(texts('vibeInvite.title')).toHaveLength(0);
    const b = { ...answers, chaos: 4 }; await act(async () => { gate.resolve({ status: 'completed', answers: b }); await tick(); });
    expect(jest.mocked(rankPresets).mock.calls.at(-1)?.[1]).toEqual(b);
});
test('focus and idle during one running job coalesce into at most one additional run', async () => {
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await act(async () => root.render(<Home />));
    await act(async () => { notifyVibeIdle(); mockFocus.forEach(fn => fn()); notifyVibeIdle(); }); expect(mockApi.request).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve({ status: 'none' }); await tick(); }); expect(mockApi.request).toHaveBeenCalledTimes(2);
});
