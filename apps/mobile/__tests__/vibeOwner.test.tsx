import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import * as SecureStore from 'expo-secure-store';
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
import Vibe from '../src/app/(app)/vibe';
import { noteOnboardingCompleted } from '../src/lib/celebrate';
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/lib/languageStore', () => ({ readLanguage: () => 'en', loadLanguage: async () => 'en' }));
jest.mock('../src/lib/celebrate', () => ({ noteOnboardingCompleted: jest.fn() }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: jest.fn() }));
test.each(['vibe.start', 'vibe.skip'])('%s records a skip, marks onboarding done and leaves', async key => {
    mockApi.request.mockResolvedValue({ status: 'skipped' });
    await act(async () => root.render(<Vibe />)); await press(key);
    expect(mockApi.request.mock.calls.map(c => c[1]?.method)).toEqual(['POST']);
    expect(mockRouter.back).toHaveBeenCalledTimes(1); expect(noteOnboardingCompleted).toHaveBeenCalledTimes(1);
    expect(await loadVibe()).toMatchObject({ state: 'skipped' });
});
test('an existing choice is kept: Start leaves without calling the server', async () => {
    await storeVibe(completed(), 'A');
    await act(async () => root.render(<Vibe />)); await press('vibe.start');
    expect(mockApi.request).not.toHaveBeenCalled(); expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(await loadVibe()).toEqual(completed());
});
test('the old questions and creator card are gone', async () => {
    await act(async () => root.render(<Vibe />));
    for (const key of ['vibe.goal.title', 'vibe.voice.title', 'vibe.card.kicker']) expect(texts(key)).toHaveLength(0);
    expect(texts('vibe.intro.title')).toHaveLength(1);
});
test('skip POST after account switch neither stores for B nor leaves', async () => {
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await act(async () => root.render(<Vibe />)); await press('vibe.skip'); await changeOwner();
    await act(async () => { gate.resolve({ status: 'skipped' }); await tick(); });
    expect(await loadVibe()).toBeNull(); expect(mockRouter.back).not.toHaveBeenCalled(); expect(noteOnboardingCompleted).not.toHaveBeenCalled(); expect(texts('vibe.intro.title')).toHaveLength(1);
});
test('same-account generation change cancels a late Start', async () => {
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await act(async () => root.render(<Vibe />)); await press('vibe.start');
    await act(async () => { mockGeneration++; root.render(<Vibe />); });
    await act(async () => { gate.resolve({ status: 'skipped' }); await tick(); });
    expect(mockRouter.back).not.toHaveBeenCalled(); expect(noteOnboardingCompleted).not.toHaveBeenCalled(); expect(texts('vibe.intro.title')).toHaveLength(1);
});
test('Skip is disabled while a Start is in flight', async () => {
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await act(async () => root.render(<Vibe />)); await press('vibe.start');
    expect(controls('vibe.skip')[0].props.disabled).toBe(true);
    await act(async () => { gate.resolve({ status: 'skipped' }); await tick(); });
});
