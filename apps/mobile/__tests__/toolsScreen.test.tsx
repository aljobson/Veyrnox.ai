import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Tools from '../src/app/(app)/create/tools';
import { type CatalogModel } from '../src/lib/media';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn();
const face = (id: string): CatalogModel => ({ id, name: `Face ${id}`, modality: 'image-to-image', credits: 3, durations: [], gated: false, capabilities: { media: { image: { required: true } } } });
const mockModels: CatalogModel[] = [face('face-retouch'), face('face-age'), face('face-makeup'),
    { id: 'topaz-upscale', name: 'Topaz Upscale', modality: 'image-to-image', credits: 5, durations: [], gated: false, capabilities: { media: { image: { required: true } } } },
    { id: 'kling-3.0-i2v', name: 'Kling i2v', modality: 'image-to-video', credits: 32, durations: [5], gated: false, capabilities: { media: { image: { required: true } } } }];
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}), Stack: { Screen: () => null } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => { cb(mockModels); return mockModels; } }));
jest.mock('../src/lib/useFaceFiltersAvailable', () => ({ useFaceFiltersAvailable: () => true }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
let root: Root;
const controls = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockPush.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('Face filters is one card in the web order, never one row per face model', async () => {
    await act(async () => root.render(<Tools />));
    const faces = controls().filter(n => String(n.props.accessibilityLabel).startsWith(`${t('toolDirectory.facefilters')}.`));
    expect(faces).toHaveLength(1);
    expect(controls().filter(n => String(n.props.accessibilityLabel).startsWith('Face face-'))).toHaveLength(0);
    // Upscale, then Face filters, then Photo to video, as on the web page.
    const labels = controls().map(n => String(n.props.accessibilityLabel));
    expect(labels.findIndex(l => l.startsWith('Topaz Upscale.'))).toBeLessThan(labels.indexOf(faces[0].props.accessibilityLabel));
    expect(labels.indexOf(faces[0].props.accessibilityLabel)).toBeLessThan(labels.findIndex(l => l.startsWith('Kling i2v.')));
    await act(async () => faces[0].props.onClick(event));
    expect(mockPush).toHaveBeenLastCalledWith('/face-filters');
});

test('every job keeps its models listed under it, each opening the Create form', async () => {
    await act(async () => root.render(<Tools />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.includes(t('toolDirectory.upscale')))).toHaveLength(1);
    const row = controls().find(n => String(n.props.accessibilityLabel).startsWith('Kling i2v.'))!;
    await act(async () => row.props.onClick(event));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'kling-3.0-i2v' } });
});
