import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import ModelCompare from '../src/app/(app)/model/compare';
import ModelDetail from '../src/app/(app)/model/[id]';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { fetchPremiumModels } from '../src/lib/premiumModels';
import { chooseLocale, t } from '../src/lib/i18n';

const mockPush = jest.fn();
let mockParams: Record<string, unknown>;
jest.mock('expo-router', () => ({
    useLocalSearchParams: () => mockParams, useRouter: () => ({ push: mockPush }),
    Stack: { Screen: () => null }, Link: ({ children }: any) => children,
}));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
jest.mock('../src/lib/premiumModels', () => ({ fetchPremiumModels: jest.fn() }));
void [RN.View, RN.Text, RN.Pressable, RN.ActivityIndicator];

const banana: CatalogModel = { id: 'nano-banana-kie', name: 'Nano Banana', modality: 'text-to-image',
    credits: 3, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
const seed: CatalogModel = { ...banana, id: 'seedream-grsai', name: 'Seedream', credits: 8,
    capabilities: { inputs: { prompt: {}, aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] } } } };
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const hasText = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const click = (label: string) => act(async () => { control(label).props.onClick(event); });
const render = () => act(async () => { root.render(<ModelCompare />); });
const renderDetail = () => act(async () => { root.render(<ModelDetail />); });

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    chooseLocale('en');
    root = createRoot(); mockPush.mockReset();
    mockParams = { a: 'nano-banana-a1', b: 'seedream-a2' };
    jest.mocked(fetchCatalog).mockReset().mockResolvedValue([banana, seed]);
    jest.mocked(fetchPremiumModels).mockReset().mockResolvedValue([]);
});
afterEach(async () => { await act(async () => root.unmount()); chooseLocale('en'); });

test('public ids render both model names, catalog prices and accessible stacked rows', async () => {
    await render();
    expect(hasText('Nano Banana vs Seedream')).toBe(true);
    expect(hasText('Nano Banana: 3 cr per image.')).toBe(true);
    expect(hasText('Seedream: 8 cr per image.')).toBe(true);
    expect(root.container.queryAll(n => n.props.accessible && !n.props.accessibilityRole && n.props.accessibilityLabel)
        .map(n => n.props.accessibilityLabel)).toEqual([
        'Price. Nano Banana: 3 cr per image. Seedream: 8 cr per image',
        'Mode. Nano Banana: text to image. Seedream: text to image',
        'Prompt. Nano Banana: Text prompt. Seedream: Text prompt',
        'Aspect ratio. Nano Banana: –. Seedream: 1:1, 16:9',
    ]);
    expect(mockPush).not.toHaveBeenCalled();
    for (const model of [banana, seed]) {
        await click(t('modelPage.generate', { title: model.name }));
        expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/create/[modelId]', params: { modelId: model.id } });
    }
    await click(t('modelPage.all'));
    expect(mockPush).toHaveBeenLastCalledWith('/models');
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(fetchPremiumModels).toHaveBeenCalledTimes(1);
});

test.each(['.', '。'])('VoiceOver removes a trailing %s while visible values retain it', async stop => {
    jest.mocked(fetchCatalog).mockResolvedValue([banana, seed].map(model => ({
        ...model, capabilities: { inputs: { prompt: {}, style: { type: 'enum', values: [`photo${stop}`] } } },
    })));
    await render();
    expect(hasText(`Nano Banana: photo${stop}`)).toBe(true);
    expect(hasText(`Seedream: photo${stop}`)).toBe(true);
    expect(control('Style. Nano Banana: photo. Seedream: photo')).toBeDefined();
});

test.each([
    {}, { a: 'nano-banana-a1' }, { b: 'seedream-a2' },
    { a: ['nano-banana-a1'], b: 'seedream-a2' }, { a: 'nano-banana-a1', b: ['seedream-a2'] },
    { a: 'unknown', b: 'seedream-a2' }, { a: 'nano-banana-a1', b: 'unknown' },
    { a: 'nano-banana-a1', b: 'nano-banana-a1' },
])('invalid pair %j offers All models without Generate', async params => {
    mockParams = params; await render();
    expect(hasText(t('modelCompare.unavailable'))).toBe(true);
    expect(control(t('modelPage.generate', { title: banana.name }))).toBeUndefined();
    await click(t('modelPage.all')); expect(mockPush).toHaveBeenCalledWith('/models');
});

test.each<Partial<CatalogModel>>([
    { gated: true }, { modality: 'text-to-video' }, { capabilities: null },
    { capabilities: { inputs: { prompt: {} }, media: { image: { required: true } } } },
])('ineligible catalog pair %j is unavailable', async extra => {
    jest.mocked(fetchCatalog).mockResolvedValue([banana, { ...seed, ...extra }]);
    await render();
    expect(hasText(t('modelCompare.unavailable'))).toBe(true);
    expect(control(t('modelPage.generate', { title: seed.name }))).toBeUndefined();
});

test('premium models are loaded but cannot be compared', async () => {
    jest.mocked(fetchCatalog).mockResolvedValue([banana]);
    jest.mocked(fetchPremiumModels).mockResolvedValue([{ ...seed, gated: true }]);
    await render(); expect(hasText(t('modelCompare.unavailable'))).toBe(true);
});

test('catalog failure shows safe copy and Retry recovers', async () => {
    jest.mocked(fetchCatalog).mockRejectedValueOnce(Error('private failure'));
    await render();
    expect(hasText(t('catalog.failed'))).toBe(true); expect(hasText('private failure')).toBe(false);
    await click(t('acct.mfa.retry'));
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    expect(hasText('Nano Banana vs Seedream')).toBe(true);
});

test('premium catalog failure does not hide open models', async () => {
    jest.mocked(fetchPremiumModels).mockRejectedValue(Error('premium outage'));
    await render(); expect(hasText('Nano Banana vs Seedream')).toBe(true);
});

test('loading waits for catalog resolution and ignores resolution after unmount', async () => {
    let finish!: (models: CatalogModel[]) => void;
    jest.mocked(fetchCatalog).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); expect(control(t('catalog.loading'))).toBeDefined();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await act(async () => root.unmount());
        await act(async () => finish([banana, seed]));
        expect(error).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
});

test.each([
    ['nano-banana-a1', 'Seedream'], ['seedream-a2', 'Nano Banana'],
])('detail picker from %s pushes the same canonical public pair', async (id, peerName) => {
    mockParams = { id }; await renderDetail();
    expect(control(peerName)).toBeUndefined();
    await click(t('modelCompare.choose'));
    expect(control(t('modelCompare.choose')).props.accessibilityState.expanded).toBe(true);
    await click(peerName);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/model/compare', params: { a: 'nano-banana-a1', b: 'seedream-a2' } });
    expect(control(peerName)).toBeUndefined();
});

test.each<{ models: CatalogModel[] }>([
    { models: [banana] }, { models: [banana, { ...seed, gated: true }] },
    { models: [banana, { ...seed, modality: 'text-to-video' }] },
    { models: [{ ...banana, gated: true }, seed] }, { models: [{ ...banana, capabilities: null }, seed] },
])('detail comparison is hidden without an eligible peer', async ({ models }) => {
    mockParams = { id: 'nano-banana-a1' };
    jest.mocked(fetchCatalog).mockResolvedValue(models);
    await renderDetail(); expect(control(t('modelCompare.choose'))).toBeUndefined();
});

test('RTL comparison accessibility labels strip interpolation isolates', async () => {
    chooseLocale('ar'); await render();
    const rows = root.container.queryAll(n => n.props.accessible && !n.props.accessibilityRole && n.props.accessibilityLabel);
    expect(rows).toHaveLength(4);
    rows.forEach(row => {
        expect(row.props.accessibilityLabel).toContain(banana.name);
        expect(row.props.accessibilityLabel).toContain(seed.name);
        expect(row.props.accessibilityLabel).not.toMatch(/[\u2068\u2069]/);
    });
});

test('installed Expo Router resolves the static comparison before the dynamic model route', () => {
    const { getStateFromPath } = jest.requireActual('expo-router/build/fork/getStateFromPath');
    const options = { screens: { 'model/[id]': 'model/:id', 'model/compare': 'model/compare' } };
    expect(getStateFromPath('/model/compare?a=nano-banana-a1&b=seedream-a2', options).routes[0])
        .toMatchObject({ name: 'model/compare', params: { a: 'nano-banana-a1', b: 'seedream-a2' } });
    expect(getStateFromPath('/model/nano-banana-a1', options).routes[0])
        .toMatchObject({ name: 'model/[id]', params: { id: 'nano-banana-a1' } });
});
