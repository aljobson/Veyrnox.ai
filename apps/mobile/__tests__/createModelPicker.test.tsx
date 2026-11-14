import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Create from '../src/app/(app)/create/[modelId]';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { readCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import { plural, t } from '../src/lib/i18n';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import { templateParams } from '../src/lib/templateHandoff';
const mockReplace = jest.fn();
let mockParams: Record<string, string>;
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => void | (() => void)) => { const React = jest.requireActual('react'); React.useEffect(() => effect(), [effect]); }, Stack: { Screen: () => null }, useRouter: () => ({ replace: mockReplace, push: jest.fn() }), useLocalSearchParams: () => mockParams }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 1000 }));
jest.mock('../src/lib/useFreeLeft', () => ({ useFreeLeft: () => ({}), useFreeLeftState: () => ({ left: {}, loading: false }) }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/lib/createDraftStore', () => ({ loadDraft: jest.fn().mockResolvedValue(null), saveDraft: jest.fn().mockResolvedValue(undefined), clearDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/components/CharacterPanel', () => ({ CharacterPanel: () => null }));
jest.mock('../src/components/CameraPanel', () => ({ CameraPanel: () => null }));
jest.mock('../src/components/SourcePicker', () => ({ SourcePicker: () => null }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable];

const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const image = (id: string, name: string, credits: number, extra: Partial<CatalogModel> = {}): CatalogModel => ({ id, name, modality: 'text-to-image', credits, gated: false, durations: [], capabilities: { inputs: { prompt: { max: 800 } } }, ...extra });
const banana = image('nano-banana', 'Nano Banana', 2);
const sana = image('sana', 'Sana v1.5 4.8B', 1);
const seedream = image('seedream-v4', 'Seedream v4', 6);
const veo = image('veo', 'Veo 3.1 Lite', 4, { modality: 'text-to-video', durations: [8] });
let root: Root;
const byLabel = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label);
const modelRow = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('create.workspace.modelLabel', { name: 'Nano Banana' })));
const sheetOpen = () => root.container.queryAll(n => n.props.presentationStyle === 'pageSheet').some(n => n.props.visible === true);
const render = async () => act(async () => root.render(<Create />));

beforeEach(async () => {
    resetCacheUser(); const storage = createMemoryStorage(); await bindCacheUser('picker-owner', createCache(storage), storage, createMemoryStorage());
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockReplace.mockClear();
    mockParams = { modelId: banana.id, prompt: 'A red kite over the sea' };
    jest.mocked(fetchCatalog).mockResolvedValue([seedream, banana, veo, sana]);
});
afterEach(async () => { await act(async () => root.unmount()); });

test('the model row opens a picker of every image model with its catalog price', async () => {
    await render();
    expect(sheetOpen()).toBe(false);
    await act(async () => modelRow()[0].props.onClick(event));
    expect(sheetOpen()).toBe(true);
    for (const [m, price] of [[sana, 1], [banana, 2], [seedream, 6]] as const) {
        expect(byLabel(`${m.name}, ${plural('create.from', price)}`)).toHaveLength(1);
    }
    expect(root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Veo'))).toHaveLength(0);
});

test('"Model options" opens the same picker', async () => {
    await render();
    const options = byLabel(`${t('create.workspace.settingsMeta')}. ${t('chat.model.change')}`);
    expect(options).toHaveLength(1);
    await act(async () => options[0].props.onClick(event));
    expect(sheetOpen()).toBe(true);
});

test('picking another model reopens Create on it and keeps the prompt', async () => {
    await render();
    await act(async () => modelRow()[0].props.onClick(event));
    await act(async () => byLabel(`${seedream.name}, ${plural('create.from', 6)}`)[0].props.onClick(event));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const route = mockReplace.mock.calls[0][0];
    expect(route).toMatchObject({ pathname: '/create/[modelId]', params: { modelId: seedream.id, prompt: 'A red kite over the sea' } });
    expect(readCreativeSourceHandoff(route.params.sourceHandoff, route.params.recipe, seedream.id)?.modelId).toBe(seedream.id);
});

test('picking the current model only closes the sheet', async () => {
    await render();
    await act(async () => modelRow()[0].props.onClick(event));
    await act(async () => byLabel(`${banana.name}, ${plural('create.from', 2)}`)[0].props.onClick(event));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(sheetOpen()).toBe(false);
});

test('a template keeps its model as the default and can still be changed', async () => {
    mockParams = { ...mockParams, ...templateParams({ title: 'Paper', needs: null, posterUrl: null }), tid: 'paper', tmodel: banana.id };
    await render();
    expect(modelRow()).toHaveLength(1);
});

test('a Tools recipe keeps its fixed model', async () => {
    mockParams = { ...mockParams, recipe: 'ai-hairstyle-changer' };
    await render();
    expect(byLabel(`${t('create.workspace.settingsMeta')}. ${t('chat.model.change')}`)).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.endsWith(t('chat.model.change')))).toHaveLength(0);
});

test('with only one model of the kind there is no picker', async () => {
    jest.mocked(fetchCatalog).mockResolvedValue([banana, veo]);
    await render();
    expect(modelRow()).toHaveLength(0);
});
