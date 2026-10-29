import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Home from '../src/app/(app)/(tabs)/index';
import { parsePresets, type Preset } from '../src/lib/presets';
import { CREATOR_PROFILE_ENABLED } from '../src/lib/creatorProfile';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn(); const mockFetch = jest.fn(); const mockPopular = jest.fn();
const mockApi = { request: jest.fn() };
let mockSearch: any;
jest.mock('expo-router', () => ({ Link: ({ children }: any) => children, useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}), useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, status: 'signedOut' }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => { cb([]); return []; }, mediaApi: () => ({ listJobs: async () => ({ jobs: [] }) }) }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: () => mockFetch() }));
jest.mock('../src/lib/templateFilters', () => ({ ...jest.requireActual('../src/lib/templateFilters'), fetchPopularIds: () => mockPopular() }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/components/credits/CheckInEntry', () => ({ CheckInEntry: () => null }));
jest.mock('../src/components/home/OddlingsBanner', () => ({ OddlingsBanner: () => null }));
jest.mock('../src/components/ui', () => ({ ...jest.requireActual('../src/components/ui'), TextField: (props: any) => { if (props.accessibilityLabel === require('../src/lib/i18n').t('explore.search')) mockSearch = props; return null; } }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
const feed = parsePresets({ presets: [
    { id: 'old-image', title: 'Old image', modality: 'text-to-image', isNew: false },
    { id: 'new-image', title: 'New image', modality: 'text-to-image', isNew: true },
    { id: 'new-video', title: 'New video', modality: 'text-to-video', isNew: true },
    { id: 'old-audio', title: 'Old audio', modality: 'text-to-audio', isNew: false },
].map(p => ({ ...p, category: 'CINEMATIC', modelId: 'model', modelName: 'Model', prompt: 'original', credits: 3 })) });
let root: Root;
const buttons = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
const control = (label: string) => buttons().find(n => n.props.accessibilityLabel === label);
const cards = () => buttons().filter(n => feed.some(p => String(n.props.accessibilityLabel).startsWith(`${p.title},`)));
const titles = () => cards().map(n => String(n.props.accessibilityLabel).split(',')[0]);
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const click = (label: string) => act(async () => control(label)!.props.onClick(event));
const render = () => act(async () => root.render(<Home />));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(); mockPush.mockReset(); mockFetch.mockReset().mockResolvedValue(feed);
    mockPopular.mockReset().mockResolvedValue(['new-video', 'new-image', 'old-image']); mockSearch = null;
});
afterEach(async () => { await act(async () => root.unmount()); });
test('NEW and POPULAR appear only with members after the type filter and announce selection', async () => {
    expect(CREATOR_PROFILE_ENABLED).toBe(false);
    await render(); await click(t('explore.categories'));
    expect(control(t('presets.cat.NEW'))).toBeDefined();
    expect(control(t('presets.cat.POPULAR'))).toBeDefined();
    await click(t('explore.type.image'));
    await click(t('presets.cat.NEW'));
    expect(titles()).toEqual(['New image']);
    expect(control(t('presets.cat.NEW'))!.props.accessibilityState.selected).toBe(true);
    await click(t('explore.type.audio'));
    expect(control(t('presets.cat.NEW'))).toBeUndefined();
    expect(control(t('presets.cat.POPULAR'))).toBeUndefined();
    expect(titles()).toEqual(['Old audio']);
    expect(mockPopular).toHaveBeenCalledTimes(1);
});
test('POPULAR keeps server rank order, filters by type, and a card opens its template page', async () => {
    await render(); await click(t('explore.categories')); await click(t('presets.cat.POPULAR'));
    expect(titles()).toEqual(['New video', 'New image', 'Old image']);
    await click(t('explore.type.image')); await click(t('presets.cat.POPULAR'));
    expect(titles()).toEqual(['New image', 'Old image']);
    await act(async () => cards()[0].props.onClick(event));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/templates/[id]', params: { id: 'new-image' } });
});
test('without new or popular members only ordinary categories appear', async () => {
    mockFetch.mockResolvedValue(feed.map((p: Preset) => ({ ...p, isNew: false })));
    mockPopular.mockResolvedValue(['missing']);
    await render(); await click(t('explore.categories'));
    expect(control(t('presets.cat.NEW'))).toBeUndefined();
    expect(control(t('presets.cat.POPULAR'))).toBeUndefined();
    expect(control(t('presets.cat.CINEMATIC'))).toBeDefined();
});
test('category toggle and search still work with popular filtering', async () => {
    await render(); await click(t('explore.categories'));
    expect(control(t('explore.categories'))!.props.accessibilityState.expanded).toBe(true);
    await click(t('presets.cat.POPULAR'));
    await click(t('explore.searchOpen'));
    await act(async () => mockSearch.onChangeText('Old image'));
    expect(titles()).toEqual(['Old image']);
    await click(t('presets.cat.POPULAR'));
    expect(control(t('presets.cat.NEW'))).toBeUndefined();
});
test('Home shows 50 templates at a time and Show more adds the next 50', async () => {
    const many = parsePresets({ presets: Array.from({ length: 120 }, (_, i) => ({ id: `tpl-${i}`, title: `Template ${i}`, modality: 'text-to-image', isNew: false, category: 'CINEMATIC', modelId: 'model', modelName: 'Model', prompt: 'p', credits: 3 })) });
    mockFetch.mockResolvedValue(many); mockPopular.mockResolvedValue([]);
    await render();
    const count = () => buttons().filter(n => /^Template \d+,/.test(String(n.props.accessibilityLabel))).length;
    expect(count()).toBe(50);
    await click(t('libraryCreate.showMore')); expect(count()).toBe(100);
    await click(t('libraryCreate.showMore')); expect(count()).toBe(120);
    expect(control(t('libraryCreate.showMore'))).toBeUndefined();
});
