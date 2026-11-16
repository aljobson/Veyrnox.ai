import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Templates from '../src/app/(app)/create/presets';
let mockList: any; let mockCatalog: any[] | null = [];
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({ kind: 'image' }), useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => { if (mockCatalog === null) throw new Error('offline'); cb(mockCatalog); return mockCatalog; } }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: async () => [] }));
jest.mock('../src/lib/imageTemplates', () => ({ ...jest.requireActual('../src/lib/imageTemplates'), fetchImageTemplates: async () => [
    { id: 'ok', name: 'Fine', category: 'REALISTIC', modelId: 'nano', prompt: 'p', previewUrl: null, previewAspect: 1, photoRequired: false },
    { id: 'red', name: 'RED LIGHT FILTER', category: 'RETRO', modelId: 'nano-banana-pro-edit-grsai', prompt: 'p', previewUrl: null, previewAspect: 1, photoRequired: true },
] }));
jest.mock('../src/lib/templateFilters', () => ({ ...jest.requireActual('../src/lib/templateFilters'), fetchPopularIds: async () => [] }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/components/TemplateCollage', () => ({ TemplateCollage: () => null }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('react-native/Libraries/Lists/FlatList', () => ({ __esModule: true, default: (props: any) => { mockList = props; const { View } = require('react-native'); return require('react').createElement(View, null); } }));
void [RN.View, RN.Text];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockList = null; });
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
