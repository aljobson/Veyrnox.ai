import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Tools from '../src/app/(app)/create/tools';
import { type CatalogModel } from '../src/lib/media';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
const face = (id: string): CatalogModel => ({ id, name: `Face ${id}`, modality: 'image-to-image', credits: 3, durations: [], gated: false, capabilities: { media: { image: { required: true } } } });
const mockModels: CatalogModel[] = [face('face-retouch'), face('face-age'), face('face-makeup'),
    { id: 'topaz-upscale', name: 'Topaz Upscale', modality: 'image-to-image', credits: 5, durations: [], gated: false, capabilities: { media: { image: { required: true } } } },
    { id: 'kling-3.0-i2v', name: 'Kling i2v', modality: 'image-to-video', credits: 32, durations: [5], gated: false, capabilities: { media: { image: { required: true } } } }];
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => mockParams, Stack: { Screen: () => null } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => { cb(mockModels); return mockModels; } }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
let root: Root;
const controls = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockPush.mockReset(); mockParams = {}; });
afterEach(async () => { await act(async () => root.unmount()); });

test('there is no Face filters card on Tools', async () => {
    await act(async () => root.render(<Tools />));
    expect(controls().filter(n => String(n.props.accessibilityLabel).startsWith(`${t('toolDirectory.facefilters')}.`))).toHaveLength(0);
});

test('every job keeps its models listed under it, each opening the Create form', async () => {
    await act(async () => root.render(<Tools />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.includes(t('toolDirectory.upscale')))).toHaveLength(1);
    const row = controls().find(n => String(n.props.accessibilityLabel).startsWith('Kling i2v.'))!;
    await act(async () => row.props.onClick(event));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'kling-3.0-i2v' } });
});

test.each(['photo', 'reference'] as const)('Start %s mode shows no Face filters card', async (mode) => {
    mockParams = { mode };
    await act(async () => root.render(<Tools />));
    expect(controls().filter(n => String(n.props.accessibilityLabel).startsWith(`${t('toolDirectory.facefilters')}.`))).toHaveLength(0);
});
