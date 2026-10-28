import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import ModelDetail from '../src/app/(app)/model/[id]';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn();
let mockId: unknown = 'video';
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }), useRouter: () => ({ push: mockPush }), Stack: { Screen: () => null }, Link: ({ children }: any) => children }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
void [RN.View, RN.Text, RN.Pressable, RN.ActivityIndicator];
const model: CatalogModel = { id: 'video', name: 'A video', modality: 'text-to-video', credits: 7, durations: [5, 10], gated: false, capabilities: { inputs: { prompt: {} } } };
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const hasText = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const click = async (label: string) => act(async () => control(label).props.onClick(event));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(); mockId = 'video'; mockPush.mockReset();
    jest.mocked(fetchCatalog).mockReset().mockResolvedValue([model]);
});
afterEach(async () => { await act(async () => root.unmount()); });
const render = () => act(async () => root.render(<ModelDetail />));
test('shows only the catalog price, ordered accessible facts and in-app destinations', async () => {
    await render();
    expect(hasText('7 cr')).toBe(true);
    expect(root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes('14')))).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessible && !n.props.accessibilityRole && n.props.accessibilityLabel).map(n => n.props.accessibilityLabel)).toEqual([
        'Mode: text to video', 'Clip lengths: 5 s, 10 s', 'Prompt: Text prompt',
    ]);
    expect(hasText('Generate with A video · 7 cr')).toBe(true);
    await click(t('modelPage.generateLabel', { title: model.name, credits: 7 }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'video' } });
    await click(t('modelPage.packs')); expect(mockPush).toHaveBeenLastCalledWith('/pricing');
    await click(t('modelPage.all')); expect(mockPush).toHaveBeenLastCalledWith('/models');
});
test.each(['unknown', undefined, ['video']])('unavailable id %p offers all models without Generate', async id => {
    mockId = id; await render();
    expect(hasText(t('modelPage.unavailable'))).toBe(true);
    expect(control(t('modelPage.generateLabel', { title: model.name, credits: 7 }))).toBeUndefined();
    await click(t('modelPage.all')); expect(mockPush).toHaveBeenCalledWith('/models');
});
test('catalog failure shows safe copy and Retry succeeds', async () => {
    jest.mocked(fetchCatalog).mockRejectedValueOnce(Error('private failure'));
    await render(); expect(hasText(t('catalog.failed'))).toBe(true); expect(hasText('private failure')).toBe(false);
    await click(t('acct.mfa.retry'));
    expect(fetchCatalog).toHaveBeenCalledTimes(2); expect(hasText('7 cr')).toBe(true);
});
test('loading is labelled and a resolution after unmount causes no update warning', async () => {
    let finish!: (models: CatalogModel[]) => void;
    jest.mocked(fetchCatalog).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await render(); expect(control(t('catalog.loading'))).toBeDefined();
        await act(async () => root.unmount());
        await act(async () => finish([model]));
        expect(error).not.toHaveBeenCalled();
    } finally { error.mockRestore(); }
});
