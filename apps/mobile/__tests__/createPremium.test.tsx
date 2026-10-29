import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Create from '../src/app/(app)/(tabs)/create';
import Models from '../src/app/(app)/models';
import Tools from '../src/app/(app)/create/tools';
import { fetchPremiumModels } from '../src/lib/premiumModels';
import { type CatalogModel } from '../src/lib/media';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn();
const mockOpen: CatalogModel = { id: 'open', name: 'Open image tool', modality: 'image-to-image', credits: 4, durations: [], gated: false, capabilities: { media: { image: { required: true } } } };
const mockPremium: CatalogModel = { ...mockOpen, id: 'premium', name: 'Gated image', gated: true };
const mockPrompt: CatalogModel = { id: 'prompt-image', name: 'Prompt image', modality: 'text-to-image', credits: 2, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
const mockVideo: CatalogModel = { id: 'long-video', name: 'Ten second video', modality: 'text-to-video', credits: 7, durations: [10, 20], gated: false, capabilities: { inputs: { prompt: {} } } };
jest.mock('expo-router', () => ({ Link: ({ href, children }: any) => require('react').cloneElement(children, { onPress: () => mockPush(href) }), useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}), Stack: { Screen: () => null } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [mockOpen], fetchAllCatalog: async () => [mockOpen, mockPremium, mockVideo], fetchCatalogCached: async (cb: any) => { cb([mockOpen, mockPrompt]); return [mockOpen, mockPrompt]; } }));
jest.mock('../src/lib/premiumModels');
jest.mock('../src/lib/useFreeLeft', () => ({ useFreeLeft: () => ({}) }));
jest.mock('../src/lib/useFaceFiltersAvailable', () => ({ useFaceFiltersAvailable: () => false }));
jest.mock('../src/lib/montage', () => ({ fetchAgentListing: async () => null }));
jest.mock('react-native/Libraries/Lists/FlatList', () => ({ __esModule: true, default: (props: any) => {
    const React = require('react'); const { View } = require('react-native');
    return React.createElement(View, null, props.ListHeaderComponent, ...props.data.map((item: any) => React.createElement(View, { key: item.id }, props.renderItem({ item }))), props.ListFooterComponent);
} }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
let root: Root;
const controls = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(); mockPush.mockReset();
    jest.mocked(fetchPremiumModels).mockReset().mockResolvedValue([mockPremium]);
});
afterEach(async () => { await act(async () => root.unmount()); });
test('Create lists no models: a goal card opens the form with its starter model', async () => {
    await act(async () => root.render(<Create />));
    for (const model of [mockOpen, mockPrompt, mockPremium]) {
        expect(root.container.queryAll(n => n.children.includes(model.name))).toHaveLength(0);
    }
    const image = controls().find(n => n.props.accessibilityLabel === t('create.goal.image'))!;
    await act(async () => image.props.onClick(event));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/create/[modelId]', params: { modelId: mockPrompt.id } });
    // No prompt-only video or audio model in this catalog, so those goals are not offered.
    expect(controls().find(n => n.props.accessibilityLabel === t('create.goal.video'))).toBeUndefined();
});
test('Models groups open and premium models together and every row opens details', async () => {
    await act(async () => root.render(<Models />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.includes(t('catalog.kind.image')))).toHaveLength(1);
    for (const model of [mockOpen, mockPremium]) {
        const row = controls().find(n => String(n.props.accessibilityLabel).includes(model.name))!;
        if (model.gated) expect(row.props.accessibilityLabel).toContain(t('projectHome.premium'));
        await act(async () => row.props.onClick(event));
        expect(mockPush).toHaveBeenLastCalledWith(`/model/${encodeURIComponent(model.id)}`);
    }
});
test('Tools rows open the Create form and carry no separate Details button', async () => {
    await act(async () => root.render(<Tools />));
    const row = controls().find(n => String(n.props.accessibilityLabel).startsWith(`${mockOpen.name}.`))!;
    await act(async () => row.props.onClick(event));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/create/[modelId]', params: { modelId: mockOpen.id } });
    expect(controls().find(n => String(n.props.accessibilityLabel).endsWith(t('projectHome.details')))).toBeUndefined();
    // A prompt model is not a tool.
    expect(controls().find(n => String(n.props.accessibilityLabel).startsWith(`${mockPrompt.name}.`))).toBeUndefined();
});
test('Models shows the first clip price in visible and accessible copy when video starts above five seconds', async () => {
    await act(async () => root.render(<Models />));
    const label = t('mdl.rowLabel', { name: mockVideo.name, credits: 14 });
    expect(controls().find(n => n.props.accessibilityLabel === label)).toBeDefined();
    expect(controls().find(n => n.props.accessibilityLabel === t('mdl.rowLabel', { name: mockVideo.name, credits: 7 }))).toBeUndefined();
    expect(root.container.queryAll(n => n.children.includes(t('mdl.from', { credits: 14 })))).toHaveLength(1);
    expect(root.container.queryAll(n => n.children.includes(t('mdl.from', { credits: 7 })))).toHaveLength(0);
});
