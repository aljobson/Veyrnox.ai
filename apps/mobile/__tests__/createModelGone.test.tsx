import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Create from '../src/app/(app)/create/[modelId]';
import { fetchCatalog } from '../src/lib/media';
import { t } from '../src/lib/i18n';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';
const mockReplace = jest.fn(); const mockBack = jest.fn(); const mockTitle = jest.fn(); let mockParams: Record<string, string> = { modelId: 'nano-banana-pro-edit-grsai' };
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => void | (() => void)) => { const React = jest.requireActual('react'); React.useEffect(() => effect(), [effect]); }, Stack: { Screen: (p: any) => { mockTitle(p.options?.title); return null; } }, useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: mockBack, canGoBack: () => true }), useLocalSearchParams: () => mockParams }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 1000 }));
jest.mock('../src/lib/useFreeLeft', () => ({ useFreeLeft: () => ({}), useFreeLeftState: () => ({ left: {}, loading: false }) }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/lib/createDraftStore', () => ({ loadDraft: jest.fn().mockResolvedValue(null), saveDraft: jest.fn().mockResolvedValue(undefined), clearDraft: jest.fn().mockResolvedValue(undefined) }));
void [RN.View, RN.Text, RN.Pressable];
let root: Root;
const press = async (label: string) => act(async () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
const hasText = (text: string) => root.container.queryAll(n => n.props.children === text).length > 0;

beforeEach(async () => {
    resetCacheUser(); const storage = createMemoryStorage(); await bindCacheUser('gone-owner', createCache(storage), storage, createMemoryStorage());
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockReplace.mockClear(); mockBack.mockClear(); mockTitle.mockClear(); mockParams = { modelId: 'nano-banana-pro-edit-grsai' };
});
afterEach(async () => { await act(async () => root.unmount()); });

const titles = () => mockTitle.mock.calls.map(c => c[0]);

test('a model missing from the catalog explains itself, offers a model picker and a way back', async () => {
    jest.mocked(fetchCatalog).mockResolvedValue([]);
    await act(async () => root.render(<Create />));
    expect(hasText(t('form.modelGone'))).toBe(true);
    expect(hasText(t('form.modelGoneBody'))).toBe(true);
    await press(t('form.modelGoneChoose'));
    expect(mockReplace).toHaveBeenLastCalledWith('/create');
    await press(t('form.modelBack'));
    expect(mockBack).toHaveBeenCalled();
});

test('from a template the way back goes to Templates', async () => {
    mockParams = { modelId: 'gone', tpl: 'RED LIGHT FILTER', tid: 'red-light' };
    jest.mocked(fetchCatalog).mockResolvedValue([]);
    await act(async () => root.render(<Create />));
    await press(t('form.modelGoneBack'));
    expect(mockReplace).toHaveBeenLastCalledWith('/create/presets');
});

test('a catalog that fails to load has the same two exits and its own message', async () => {
    jest.mocked(fetchCatalog).mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<Create />));
    expect(hasText(t('form.modelLoad'))).toBe(true);
    expect(hasText(t('form.modelLoadBody'))).toBe(true);
    await press(t('form.modelGoneChoose'));
    expect(mockReplace).toHaveBeenLastCalledWith('/create');
});

test('loading, gone and load-failed states all carry the static title, never the route name', async () => {
    let release: (v: any[]) => void = () => {};
    jest.mocked(fetchCatalog).mockReturnValueOnce(new Promise(r => { release = r; }));
    await act(async () => root.render(<Create />));
    expect(titles().at(-1)).toBe(t('label.Create'));
    await act(async () => release([]));
    expect(titles().at(-1)).toBe(t('label.Create'));
    await act(async () => root.unmount()); root = createRoot();
    jest.mocked(fetchCatalog).mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<Create />));
    expect(titles().at(-1)).toBe(t('label.Create'));
    for (const title of titles()) expect(String(title)).not.toMatch(/[[\]]|modelId/);
});
