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
import Vibe from '../src/app/(app)/vibe';
import { noteOnboardingCompleted } from '../src/lib/celebrate';
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/lib/languageStore', () => ({ readLanguage: () => 'en', loadLanguage: async () => 'en' }));
jest.mock('../src/lib/celebrate', () => ({ noteOnboardingCompleted: jest.fn() }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: jest.fn() }));
async function fill() {
    for (const key of ['start', 'goal.story', 'look.neon_rain', 'pace.octopus', 'chaos.2', 'destination.tiktok', 'audience.me', 'voice.calm']) await press(`vibe.${key}`);
}
test.each([false, true])('finish for A after switching to B shows no card and preserves B (existing=%s)', async existing => {
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await act(async () => root.render(<Vibe />)); await fill(); await press('vibe.voice.done');
    await changeOwner(); if (existing) await storeVibe(completed({ ...answers, chaos: 4 }), 'B');
    await act(async () => { gate.resolve({ status: 'completed' }); await tick(); });
    expect(texts('vibe.intro.title')).toHaveLength(1); expect(texts('vibe.card.kicker')).toHaveLength(0); expect(noteOnboardingCompleted).not.toHaveBeenCalled();
    expect(await loadVibe()).toEqual(existing ? completed({ ...answers, chaos: 4 }) : null);
});
test('skip POST after account switch neither stores for B nor moves to skipped', async () => {
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await act(async () => root.render(<Vibe />)); await press('vibe.skip'); await changeOwner();
    await act(async () => { gate.resolve({ status: 'skipped' }); await tick(); });
    expect(await loadVibe()).toBeNull(); expect(texts('vibe.skipped.title')).toHaveLength(0); expect(texts('vibe.intro.title')).toHaveLength(1);
});
test('finish superseded by Skip shows no card or onboarding; kept skip goes back with server answers', async () => {
    const put = deferred(), post = deferred(); mockApi.request.mockImplementation(async (_path, init) => init?.method === 'PUT' ? put.promise : init?.method === 'POST' ? post.promise : { status: 'completed', answers });
    await act(async () => root.render(<Vibe />)); await fill(); await press('vibe.voice.done'); await press('vibe.skip');
    await act(async () => { put.resolve({ status: 'completed' }); await tick(); }); expect(texts('vibe.card.kicker')).toHaveLength(0); expect(noteOnboardingCompleted).not.toHaveBeenCalled();
    await act(async () => { post.resolve({ status: 'completed' }); await tick(); }); expect(mockRouter.back).toHaveBeenCalledTimes(1); expect(texts('vibe.skipped.title')).toHaveLength(0); expect(await loadVibe()).toEqual(completed());
});
test('skip superseded by Reset elsewhere leaves step unchanged and enables Skip', async () => {
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await act(async () => root.render(<Vibe />)); await press('vibe.skip');
    const reset = runVibeIntent(mockApi, mockTask(), { kind: 'reset' }); await act(async () => { gate.resolve({ status: 'skipped' }); await reset; await tick(); });
    expect(texts('vibe.skipped.title')).toHaveLength(0); expect(controls('vibe.skip')[0].props.disabled).toBe(false);
});
test('same-account generation change resets the interview and a late finish cannot change it', async () => {
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await act(async () => root.render(<Vibe />)); await fill(); await press('vibe.voice.done');
    await act(async () => { mockGeneration++; root.render(<Vibe />); }); expect(texts('vibe.intro.title')).toHaveLength(1);
    await act(async () => { gate.resolve({ status: 'completed' }); await tick(); }); expect(texts('vibe.intro.title')).toHaveLength(1); expect(noteOnboardingCompleted).not.toHaveBeenCalled();
});
test('account_changed rejection after a switch shows no error', async () => {
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await act(async () => root.render(<Vibe />)); await fill(); await press('vibe.voice.done'); await changeOwner();
    await act(async () => { gate.reject(new ApiError(401, 'account_changed')); await tick(); }); expect(texts('vibe.error')).toHaveLength(0); expect(await loadVibe()).toBeNull();
});
test('a loaded interview draft is cleared on account switch before a later finish', async () => {
    await act(async () => root.render(<Vibe />)); await fill(); const field = root.container.queryAll(n => n.type === 'field')[0];
    await act(async () => field.props.onChangeText('A studio')); await changeOwner(); expect(texts('vibe.intro.title')).toHaveLength(1);
    await fill(); await press('vibe.voice.done'); const put = mockApi.request.mock.calls.find(c => c[1]?.method === 'PUT')!; expect(JSON.parse(put[1].body).studio_name).toBeUndefined();
});

test('Finish superseding an in-flight Skip re-enables Skip when Finish fails', async () => {
    jest.useFakeTimers();
    try {
        const skip = deferred();
        mockApi.request.mockImplementation(async (_path, init) => {
            if (init?.method === 'POST') return skip.promise;
            if (init?.method === 'PUT') throw new ApiError(0, 'network');
            return { status: 'skipped' };
        });
        await act(async () => root.render(<Vibe />)); await fill(); await press('vibe.skip');
        expect(controls('vibe.skip')[0].props.disabled).toBe(true);
        await press('vibe.voice.done');
        await act(async () => { skip.resolve({ status: 'skipped' }); await tick(); await jest.advanceTimersByTimeAsync(1000); });
        expect(mockApi.request.mock.calls.map(c => c[1]?.method ?? 'GET')).toEqual(['POST', 'PUT', 'GET']);
        expect(texts('vibe.error')).toHaveLength(1); expect(texts('vibe.card.kicker')).toHaveLength(0);
        expect(controls('vibe.skip')[0].props.disabled).toBe(false); expect(noteOnboardingCompleted).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
});
