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
import Account from '../src/app/(app)/account';
import { VIBE_REQUEST_DEADLINE_MS } from '../src/lib/creatorProfile';
jest.mock('../src/lib/auth/accountCalls', () => ({ fetchProfile: async () => null }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => ({ status: 'off', activeProductIds: [], refreshSales: jest.fn() }) }));
jest.mock('../src/push/pushContext', () => ({ usePush: () => ({ supported: false }) }));
test.each(['none', 'completed', '404', 'network'])('Account server eligibility: %s', async status => {
    if (status === '404' || status === 'network') mockApi.request.mockRejectedValue(new ApiError(status === '404' ? 404 : 0, 'error'));
    else mockApi.request.mockResolvedValue({ status, answers });
    await act(async () => root.render(<Account />)); expect(controls('vibe.account.retake')).toHaveLength(status === '404' || status === 'network' ? 0 : 1);
});
test('Account hides immediately on B until B’s status arrives', async () => {
    await act(async () => root.render(<Account />)); expect(controls('vibe.account.retake')).toHaveLength(1);
    const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await changeOwner(); expect(controls('vibe.account.retake')).toHaveLength(0);
    await act(async () => { gate.resolve({ status: 'none' }); await tick(); }); expect(controls('vibe.account.retake')).toHaveLength(1);
});
test.each(['B', 'same'])('stale Reset for %s leaves the new record and shows no note', async next => {
    await storeVibe(completed(), 'A'); await act(async () => root.render(<Account />)); const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise);
    await press('vibe.account.reset'); await act(async () => { mockGeneration++; await bindCacheUser(next === 'B' ? 'B' : 'A'); root.render(<Account />); });
    await storeVibe(completed({ ...answers, chaos: 4 }), next === 'B' ? 'B' : 'A');
    await act(async () => { gate.resolve({}); await tick(); }); expect(texts('vibe.account.resetDone')).toHaveLength(0); expect(texts('vibe.error')).toHaveLength(0); expect(await loadVibe()).toEqual(completed({ ...answers, chaos: 4 }));
});
test('Reset superseded by a finish sets no note', async () => {
    await act(async () => root.render(<Account />)); const gate = deferred(); mockApi.request.mockReturnValueOnce(gate.promise); await press('vibe.account.reset');
    const finish = runVibeIntent(mockApi, mockTask(), { kind: 'save', answers }); await act(async () => { gate.resolve({}); await finish; await tick(); });
    expect(texts('vibe.account.resetDone')).toHaveLength(0); expect(texts('vibe.error')).toHaveLength(0); expect(await loadVibe()).toEqual(completed());
});
test('Reset local delete failure shows error, never resetDone', async () => {
    await storeVibe(completed(), 'A'); await act(async () => root.render(<Account />)); const original = jest.mocked(SecureStore.deleteItemAsync).getMockImplementation()!;
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValue(new Error('disk')); await press('vibe.account.reset');
    expect(texts('vibe.error')).toHaveLength(1); expect(texts('vibe.account.resetDone')).toHaveLength(0); jest.mocked(SecureStore.deleteItemAsync).mockImplementation(original);
});
test.each([true, false])('uncertain Reset reports the reconciled state (landed=%s)', async landed => {
    jest.useFakeTimers(); await storeVibe(completed(), 'A'); await act(async () => root.render(<Account />));
    mockApi.request.mockImplementation(async (_path, init) => { if (init?.method === 'DELETE') throw new ApiError(0, 'network'); return landed ? { status: 'none' } : { status: 'completed', answers }; });
    await press('vibe.account.reset'); await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
    expect(texts(landed ? 'vibe.account.resetDone' : 'vibe.error')).toHaveLength(1); expect(await loadVibe()).toEqual(landed ? null : completed()); jest.useRealTimers();
});
test('status read stalled body hides section at deadline; later focus can show it', async () => {
    jest.useFakeTimers(); mockApi.request.mockReturnValueOnce(new Promise(() => {})); await act(async () => root.render(<Account />));
    await act(async () => { await jest.advanceTimersByTimeAsync(VIBE_REQUEST_DEADLINE_MS); }); expect(controls('vibe.account.retake')).toHaveLength(0);
    await act(async () => { mockFocus.forEach(fn => fn()); await tick(); }); expect(controls('vibe.account.retake')).toHaveLength(1); jest.useRealTimers();
});
