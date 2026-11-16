import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Templates from '../src/app/(app)/create/presets';
let mockList: any; let mockCatalog: any[] | null = []; let mockStale = false; let mockHold: Promise<void> | null = null;
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({ kind: 'image' }), useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => { if (mockCatalog === null) throw new Error('offline'); if (mockHold) await mockHold; cb(mockCatalog, { fromCache: mockStale, stale: mockStale, savedAt: 0, ageMs: 0 }); return mockCatalog; } }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: async () => [] }));
jest.mock('../src/lib/imageTemplates', () => ({ ...jest.requireActual('../src/lib/imageTemplates'), fetchImageTemplates: async () => [
    { id: 'ok', name: 'Fine', category: 'REALISTIC', modelId: 'nano', prompt: 'p', previewUrl: null, previewAspect: 1, photoRequired: false },
    { id: 'red', name: 'RED LIGHT FILTER', category: 'RETRO', modelId: 'nano-banana-pro-edit-grsai', prompt: 'p', previewUrl: null, previewAspect: 1, photoRequired: true },
] }));
jest.mock('../src/lib/templateFilters', () => ({ ...jest.requireActual('../src/lib/templateFilters'), fetchPopularIds: async () => [] }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/components/TemplateCollage', () => ({ TemplateCollage: () => null }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('react-native/Libraries/Lists/FlatList', () => ({ __esModule: true, default: (props: any) => { mockList = props; const { View } = require('react-native'); const React = require('react'); return React.createElement(View, null, props.ListHeaderComponent); } }));
void [RN.View, RN.Text];
let root: Root;
beforeEach(() => { mockStale = false; mockHold = null; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockList = null; });
afterEach(async () => { await act(async () => root.unmount()); });
const open = async (catalog: any[] | null) => { mockCatalog = catalog; await act(async () => root.render(<Templates />)); };

test('opening Images directly hides a template whose model the catalog does not list', async () => {
    await open([{ id: 'nano', name: 'Nano', modality: 'text-to-image', credits: 3 }]);
    expect(mockList.data.map((i: any) => i.id)).toEqual(['ok']);
});
test('Images keeps every template while the catalog is unknown', async () => {
    await open(null);
    expect(mockList.data.map((i: any) => i.id)).toEqual(['ok', 'red']);
});
test('a stale saved catalog does not hide anything', async () => {
    mockStale = true;
    await open([{ id: 'nano', name: 'Nano', modality: 'text-to-image', credits: 3 }]);
    expect(mockList.data.map((i: any) => i.id)).toEqual(['ok', 'red']);
});
test('a chosen category that the catalog later removes falls back to All', async () => {
    let deliver: () => void = () => {};
    mockCatalog = [{ id: 'nano', name: 'Nano', modality: 'text-to-image', credits: 3 }];
    mockHold = new Promise<void>(resolve => { deliver = resolve; });
    await act(async () => root.render(<Templates />));
    expect(mockList.data.map((i: any) => i.id)).toEqual(['ok', 'red']);
    const chip = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && /retro/i.test(String(n.props.accessibilityLabel)))[0];
    await act(async () => chip().props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(mockList.data.map((i: any) => i.id)).toEqual(['red']);
    await act(async () => { deliver(); await mockHold; });
    expect(mockList.data.map((i: any) => i.id)).toEqual(['ok']);
});
