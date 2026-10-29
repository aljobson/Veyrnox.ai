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
import Templates from '../src/app/(app)/create/presets';
import { parsePresets } from '../src/lib/presets';
import { rankPresets } from '../src/lib/creatorTaste';
let mockList: any;
const mockFetch = jest.fn();
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: () => mockFetch() }));
jest.mock('../src/lib/templateFilters', () => ({ ...jest.requireActual('../src/lib/templateFilters'), fetchPopularIds: async () => [] }));
jest.mock('../src/components/TemplateCollage', () => ({ TemplateCollage: () => null }));
jest.mock('../src/components/templates/TemplateCard', () => ({ TemplateCard: () => null }));
jest.mock('react-native/Libraries/Lists/FlatList', () => ({ __esModule: true, default: (props: any) => { mockList = props; return require('react').createElement('list', {}, props.ListHeaderComponent); } }));
const feed = parsePresets({ presets: [
    { id: 'product', title: 'Product', category: 'PRODUCT', modelId: 'one', modelName: 'One', modality: 'text-to-image', prompt: 'product', credits: 3 },
    { id: 'neon', title: 'Neon Rain', category: 'CINEMATIC', modelId: 'two', modelName: 'Two', modality: 'text-to-image', prompt: 'neon rain cinematic story', credits: 3 },
] });
test('Templates ranking drops A’s loaded answers immediately when B is bound, without Retry', async () => {
    mockFetch.mockResolvedValue(feed); await storeVibe(completed(), 'A'); await act(async () => root.render(<Templates />));
    expect(mockList.data.map((p: any) => p.id)).toEqual(rankPresets(feed, answers).map(p => p.id));
    expect(rankPresets(feed, answers).map(p => p.id)).not.toEqual(feed.map(p => p.id));
    await changeOwner(); expect(mockList.data.map((p: any) => p.id)).toEqual(feed.map(p => p.id));
});
test('Templates Retry re-reads answers without a notification', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(feed); await act(async () => root.render(<Templates />));
    mockDisk.set('veyrnox.vibe.v2', JSON.stringify({ owner: 'A', value: JSON.stringify(completed()) })); await press('recovery.retry');
    expect(mockList.data.map((p: any) => p.id)).toEqual(rankPresets(feed, answers).map(p => p.id));
});
