import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Create from '../src/app/(app)/create/[modelId]';
import { CharacterPanel } from '../src/components/CharacterPanel';
import { SourcePicker } from '../src/components/SourcePicker';
import { templateParams } from '../src/lib/templateHandoff';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { stageCreativeSourceHandoff, readCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import { buildCharacterPrompt } from '../src/lib/oddlingsBuilder';
import { t } from '../src/lib/i18n';
import { loadDraft } from '../src/lib/createDraftStore';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import { english } from '../src/lib/i18n/binding';
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockRun = jest.fn();
let mockApi = {};
const mockFetchScene = jest.fn();
jest.mock('../src/lib/swapScenes', () => ({ ...jest.requireActual('../src/lib/swapScenes'), fetchSwapScene: (...args: unknown[]) => mockFetchScene(...args) }));
let mockFocused = true;
let mockParams: Record<string,string>;
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => void | (() => void)) => { const React = jest.requireActual('react'); React.useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]); }, Stack: { Screen: () => null }, useRouter: () => ({ replace: mockReplace, push: mockPush }), useLocalSearchParams: () => mockParams }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 1000 }));
jest.mock('../src/lib/useFreeLeft', () => ({ useFreeLeft: () => ({}), useFreeLeftState: () => ({ left: {}, loading: false }) }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/lib/createDraftStore', () => ({ loadDraft: jest.fn().mockResolvedValue(null), saveDraft: jest.fn().mockResolvedValue(undefined), clearDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/generationSubmit', () => ({ ...jest.requireActual('../src/lib/generationSubmit'), createGenerationSubmit: () => ({ ...jest.requireActual('../src/lib/generationSubmit').createGenerationSubmit(), run: mockRun }) }));
jest.mock('../src/components/CharacterPanel', () => ({ CharacterPanel: jest.fn(() => null) }));
jest.mock('../src/components/CameraPanel', () => ({ CameraPanel: () => null }));
jest.mock('../src/components/SourcePicker', () => ({ SourcePicker: jest.fn(() => null) }));
jest.mock('../src/components/AttachFromDevice', () => ({ AttachFromDevice: () => null }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const video: CatalogModel = { id: 'wan-2.5-kie', name: 'Wan', modality: 'text-to-video', credits: 2, gated: false, durations: [5,10], capabilities: { inputs: { prompt: { max: 800 }, aspect: { values: ['9:16','16:9'] } } } };
const input = () => root.container.queryAll(n => n.props.accessibilityLabel === t('mobile.prompt'))[0];
beforeEach(async () => {
    mockApi = {}; mockFetchScene.mockReset();
    resetCacheUser(); const storage = createMemoryStorage(); await bindCacheUser('create-owner', createCache(storage), storage, createMemoryStorage()); mockFocused = true;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockReplace.mockClear(); mockPush.mockClear(); mockRun.mockReset().mockImplementation(async (_api: unknown, _request: unknown, _count: number, onStarted?: (n: number) => void, onJob?: (id: string, index: number) => void) => { onStarted?.(1); onJob?.('job', 0); return 'job'; }); jest.mocked(CharacterPanel).mockClear();
    mockParams = { modelId: video.id, prompt: 'A quiet original scene', duration: '5' };
    jest.mocked(fetchCatalog).mockResolvedValue([video]);
});
afterEach(async () => { await act(async () => root.unmount()); });
const render = async () => act(async () => root.render(<Create />));

test('a reference template handoff renders video and two-picture slots with its needs on the image slot', async () => {
    const needs = 'One video (3–10 s, at least 720p) and two reference pictures';
    const model: CatalogModel = { ...video, id: 'kling-o1-reference', name: 'Kling O1 · Reference', capabilities: {
        inputs: { prompt: { max: 2000 } }, media: {
            video: { required: true, minSeconds: 3, maxSeconds: 10, minSide: 720, maxSide: 2160 },
            image: { required: true, maxFiles: 2, label: 'Reference pictures' },
        },
    } };
    mockParams = { ...mockParams, modelId: model.id, ...templateParams({ title: 'Paper Landscape', needs, posterUrl: null }) };
    jest.mocked(fetchCatalog).mockResolvedValue([model]);
    jest.mocked(SourcePicker).mockClear();
    await render();
    const props = jest.mocked(SourcePicker).mock.calls.map(([props]) => props);
    const image = props.find(props => props.slot.slot === 'image');
    const clip = props.find(props => props.slot.slot === 'video');
    expect(image?.slot).toMatchObject({ required: true, maxFiles: 2, label: 'Reference pictures' });
    expect(image?.hint).toBe(t('create.template.needs', { what: needs }));
    expect(clip?.slot).toMatchObject({ required: true, minSeconds: 3, maxSeconds: 10, minSide: 720, maxSide: 2160 });
    expect(clip?.hint).toBeUndefined();
});
function handoff(extra: object, recipe = 'faceless-reel') {
    mockParams.recipe = recipe;
    mockParams.sourceHandoff = stageCreativeSourceHandoff({ recipe, modelId: mockParams.modelId, uploaded: {}, fromLibrary: {}, ...extra });
}
test('image prompt models enable the panel with sanitized picks', async () => {
    jest.mocked(fetchCatalog).mockResolvedValue([{ ...video, modality: 'text-to-image' }]);
    handoff({ picks: { character_type: 'Human', evil: 'discard' } },'oddlings'); await render();
    expect(jest.mocked(CharacterPanel).mock.calls.at(-1)?.[0]).toMatchObject({ on: true, picks: { character_type: 'Human' } });
    expect(input().props.value).toBe(mockParams.prompt);
});
test('other models preserve picks by building the opening prompt', async () => {
    handoff({ picks: { character_type: 'Human', evil: 'discard' } },'oddlings'); await render();
    expect(input().props.value).toBe(buildCharacterPrompt(mockParams.prompt,{character_type:'Human'}));
    expect(CharacterPanel).not.toHaveBeenCalled();
});
test.each([{ duration:'5', hand:true, sound:true, follow:true },{ duration:'10', hand:true, sound:true, follow:false },{ duration:'5', hand:false, sound:true, follow:false },{ duration:'5', hand:true, sound:false, follow:false }])('single successful submit uses followup only for the qualified handoff: %s', async c => {
    mockParams.duration = c.duration;
    if (c.hand) handoff(c.sound ? { followup: 'generated-sound' } : {});
    await render();
    const generate = root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('slip.generate')+'.'))[0];
    expect(generate.props.accessibilityState.disabled).toBe(false);
    await act(async () => generate.props.onClick(event));
    expect(mockRun).toHaveBeenCalled();
    // Results stay on Create (library-create-a); only the qualified Faceless Reel clip opens its job page for the sound step.
    if (c.follow) expect(mockReplace).toHaveBeenCalledWith({ pathname:'/job/[id]',params:{id:'job',followup:'faceless-sound'} });
    else expect(mockReplace).not.toHaveBeenCalled();
});
test.each([['9:16', '9:16'], ['unsupported', '16:9']])('Film Studio aspect %s opens as %s', async (aspect, expected) => {
    jest.mocked(fetchCatalog).mockResolvedValue([{ ...video, capabilities: { inputs: { prompt: { max: 800 }, aspect_ratio: { values: ['9:16', '16:9'] } } } }]);
    mockParams.aspect = aspect; await render();
    const generate = root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('slip.generate')+'.'))[0];
    await act(async () => generate.props.onClick(event));
    expect(mockRun.mock.calls[0][1].extraInputs.aspect_ratio).toBe(expected);
});


test('a valid aspect parameter also wins over a restored draft', async () => {
    jest.mocked(fetchCatalog).mockResolvedValue([{ ...video, capabilities: { inputs: { prompt: { max: 800 }, aspect_ratio: { values: ['9:16', '16:9'] } } } }]);
    delete mockParams.prompt; mockParams.aspect = '9:16';
    jest.mocked(loadDraft).mockResolvedValueOnce({ v: 1, modelId: video.id, prompt: 'Restored scene', duration: 5, aspect: '16:9', count: 1, seed: '', negative: '' } as any);
    await render();
    const generate = root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('slip.generate')+'.'))[0];
    await act(async () => generate.props.onClick(event));
    expect(mockRun.mock.calls[0][1].extraInputs.aspect_ratio).toBe('9:16');
});

test('Create initialization finishes after blur and is ready when focused again', async () => {
    let finish!: (models: CatalogModel[]) => void;
    jest.mocked(fetchCatalog).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render(); mockFocused = false; await render();
    await act(async () => finish([video]));
    mockFocused = true; await render();
    expect(input().props.value).toBe(mockParams.prompt);
    expect(root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('slip.generate') + '.')).length).toBeGreaterThan(0);
});
const templatesEntry = () => root.container.queryAll(n => n.props.accessibilityLabel === t('label.Templates'));

test('a bare form offers Templates and opens the gallery', async () => {
    await render();
    expect(templatesEntry()).toHaveLength(1);
    await act(async () => templatesEntry()[0].props.onClick(event));
    expect(mockPush).toHaveBeenCalledWith('/create/presets');
});
test('a form opened from a template does not offer Templates', async () => {
    mockParams = { ...mockParams, ...templateParams({ title: 'Paper Landscape', needs: null, posterUrl: null }) };
    await render();
    expect(templatesEntry()).toHaveLength(0);
});
test('Templates goes away once a result arrives', async () => {
    await render();
    const generate = root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('slip.generate')+'.'))[0];
    await act(async () => generate.props.onClick(event));
    expect(mockRun).toHaveBeenCalled();
    expect(templatesEntry()).toHaveLength(0);
});

test('QA-003: an automatic model switch keeps the template card and says why', async () => {
    const other = { ...video, id: 'image-edit', name: 'Image Edit' };
    jest.mocked(fetchCatalog).mockResolvedValue([video, other]);
    const template = { tid: 'paper', ...templateParams({ title: 'Paper', needs: null, posterUrl: null }) };
    mockParams = { ...mockParams, ...template, modelId: other.id, tmodel: video.id, switched: '1' };
    await render();
    expect(root.container.queryAll(n => n.children.includes(t('create.template.label'))).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.children.includes(t('handoff.switchedModel', { model: 'Image Edit' }))).length).toBeGreaterThan(0);
    const generate = root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('slip.generate') + '.'))[0];
    mockRun.mockImplementation(async () => undefined);
    await act(async () => generate.props.onClick(event));
    expect(mockRun.mock.calls.at(-1)?.[1].preset).toBeUndefined();
});

test('QA-007: with a reference there is no rights tick and no Change model control', async () => {
    jest.mocked(fetchCatalog).mockResolvedValue([video]);
    handoff({ references: [{ slot: 'image', origin: 'asset', asset_id: 'ref-1' }], rightsConfirmed: false });
    await render();
    const text = (key: string) => root.container.queryAll(n => n.children.includes(t(key))).length;
    expect(text('create.workspace.rightsNeeded')).toBe(0);
    expect(text('chat.model.change')).toBe(0);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')).toHaveLength(0);
});


test.each([false, true])('API identity refresh preserves model, photos and uploads (scene=%s)', async sceneMode => {
    const selected = { ...video, id: 'swap-recast', capabilities: { inputs: { prompt: { max: 1000 } }, media: { image: { required: true, maxFiles: 1 } } } };
    jest.mocked(fetchCatalog).mockResolvedValue([selected]);
    mockParams = { modelId: selected.id, ...(sceneMode ? { swap: 'scene-a' } : {}) };
    mockFetchScene.mockResolvedValue({ id: 'scene-a', swapOffer: selected.id, people: 1, credits: 134, durationSeconds: 5 });
    await render();
    const picked = [{ slot: 'image' as const, origin: 'upload' as const, key: 'uploads/owner/photo.jpg' }];
    const picker = () => jest.mocked(SourcePicker).mock.calls.at(-1)![0];
    await act(async () => { picker().onReferences!(picked); });
    await act(async () => { picker().onBusy?.(true); });
    const reads = jest.mocked(fetchCatalog).mock.calls.length, sceneReads = mockFetchScene.mock.calls.length;
    mockApi = { refreshed: true };
    await render();
    expect(jest.mocked(fetchCatalog)).toHaveBeenCalledTimes(reads);
    expect(mockFetchScene).toHaveBeenCalledTimes(sceneReads);
    expect(picker().references).toEqual(picked);
    const generate = root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('slip.generate') + '.'))[0];
    expect(generate.props.accessibilityState.disabled).toBe(true);
    await act(async () => { picker().onBusy?.(false); });
    // The mounted form's next request still belongs to the selected model.
    const readyGenerate = root.container.queryAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(t('slip.generate') + '.'))[0];
    await act(async () => readyGenerate.props.onClick(event));
    expect(mockRun.mock.calls.at(-1)?.[1]).toMatchObject({ modelId: selected.id, references: picked, sourceRights: true });
});
