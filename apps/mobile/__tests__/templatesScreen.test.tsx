import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Templates from '../src/app/(app)/create/presets';
import TemplatePage from '../src/app/(app)/templates/[id]';
import { parsePresets } from '../src/lib/presets';
import { t } from '../src/lib/i18n';
import { GENERATION_PROMPT_MAX } from '../src/lib/promptLimits';
const mockRouter = { push: jest.fn() };
const mockFetch = jest.fn(); const mockPopular = jest.fn(); const mockCopy = jest.fn();
const mockPlayers: { play: jest.Mock; pause: jest.Mock; muted: boolean; loop: boolean }[] = [];
let mockList: any, mockTextField: any;
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: 'p-0' }), useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: () => mockFetch() }));
jest.mock('../src/lib/templateFilters', () => ({ ...jest.requireActual('../src/lib/templateFilters'), fetchPopularIds: () => mockPopular() }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/lib/clipboard', () => ({ copyText: (text: string) => mockCopy(text) }));
jest.mock('../src/components/TemplateCollage', () => ({ TemplateCollage: () => null }));
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: () => null }));
jest.mock('../src/components/ui', () => ({ ...jest.requireActual('../src/components/ui'), TextField: (props: any) => { mockTextField = props; return null; } }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-video', () => ({
    VideoView: jest.requireActual('react-native').View,
    useVideoPlayer: (_url: string, setup: any) => require('react').useMemo(() => { const p = { play: jest.fn(), pause: jest.fn(), muted: false, loop: false }; setup(p); mockPlayers.push(p); return p; }, []),
}));
jest.mock('react-native/Libraries/Lists/FlatList', () => ({ __esModule: true, default: (props: any) => {
    mockList = props; const React = require('react'); const { View } = require('react-native');
    return React.createElement(View, null, props.ListHeaderComponent, ...props.data.slice(0, 4).map((item: any) => React.createElement(View, { key: item.id }, props.renderItem({ item }))), props.ListFooterComponent);
} }));
void [RN.View, RN.Text, RN.StyleSheet, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
const feed = parsePresets({ presets: Array.from({ length: 51 }, (_, i) => ({ id: `p-${i}`, title: `Template ${i}`, category: i % 2 ? 'PET' : 'STYLE', modelId: 'model', modelName: 'Model', modality: 'image-to-video', prompt: 'original', credits: 3, previewUrl: 'https://preview', isNew: i === 0 })) });
let root: Root;
const controls = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
async function click(label: string, index = 0) { await act(async () => controls(label)[index].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); mockPlayers.length = 0; mockFetch.mockResolvedValue(feed); mockPopular.mockResolvedValue(['p-2', 'p-0']); mockCopy.mockResolvedValue(true); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('filters chips, batches fifty, and opens a template page', async () => {
    await act(async () => root.render(<Templates />)); expect(mockList.data).toHaveLength(50);
    await click(t('libraryCreate.showMore')); expect(mockList.data).toHaveLength(51);
    await click(t('libraryCreate.popular')); expect(mockList.data.map((p: any) => p.id)).toEqual(['p-2', 'p-0']);
    await click(t('explore.new')); expect(mockList.data).toHaveLength(1);
    await click('Template 0'); expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/templates/[id]', params: { id: 'p-0' } });
});
test('Popular is hidden on failed popular fetch and search uses the new placeholder', async () => {
    mockPopular.mockResolvedValue([]); await act(async () => root.render(<Templates />));
    expect(controls(t('libraryCreate.popular'))).toHaveLength(0); expect(mockTextField.placeholder).toBe(t('libraryCreate.searchTemplates'));
    await act(async () => mockTextField.onChangeText('Template 50')); expect(mockList.data).toHaveLength(1);
});
test('only a deliberately selected preview plays, muted; selecting another pauses the first', async () => {
    await act(async () => root.render(<Templates />)); expect(mockPlayers).toHaveLength(0);
    await click(t('cinemaBrowse.play')); expect(mockPlayers[0].muted).toBe(true); expect(mockPlayers[0].play).toHaveBeenCalledTimes(1);
    await click(t('cinemaBrowse.play')); expect(mockPlayers[0].pause).toHaveBeenCalledTimes(1); expect(mockPlayers[1].play).toHaveBeenCalledTimes(1);
});
test('template page copies the edited prompt and uses it with the validated template id', async () => {
    await act(async () => root.render(<TemplatePage />));
    expect(mockTextField.maxLength).toBe(GENERATION_PROMPT_MAX); await act(async () => mockTextField.onChangeText('edited words'));
    await click(t('editor.copy')); expect(mockCopy).toHaveBeenCalledWith('edited words');
    expect(root.container.queryAll(n => n.children.includes(t('libraryCreate.copied')))).toHaveLength(1);
    await click(t('libraryCreate.useTemplate')); expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/create/[modelId]', params: expect.objectContaining({ tid: 'p-0', prompt: 'edited words' }) });
});
test('template page preserves prompts longer than the old 2,000-character ceiling', async () => {
    const prompt = 'x'.repeat(3722);
    mockFetch.mockResolvedValue(parsePresets({ presets: [{ id: 'p-0', title: 'Long template', category: 'STYLE', modelId: 'model', modelName: 'Model', modality: 'text-to-image', prompt, credits: 3 }] }));
    await act(async () => root.render(<TemplatePage />));
    expect(mockTextField.value).toBe(prompt);
    expect(mockTextField.maxLength).toBe(GENERATION_PROMPT_MAX);
});
