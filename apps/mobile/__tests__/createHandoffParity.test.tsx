import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Create from '../src/app/(app)/create/[modelId]';
import { CharacterPanel } from '../src/components/CharacterPanel';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { stageCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import { buildCharacterPrompt } from '../src/lib/oddlingsBuilder';
import { t } from '../src/lib/i18n';
import { english } from '../src/lib/i18n/binding';
const mockReplace = jest.fn();
const mockRun = jest.fn();
const mockApi = {};
let mockParams: Record<string,string>;
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ replace: mockReplace, push: jest.fn() }), useLocalSearchParams: () => mockParams }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn() }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 1000 }));
jest.mock('../src/lib/useFreeLeft', () => ({ useFreeLeft: () => ({}), useFreeLeftState: () => ({ left: {}, loading: false }) }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/lib/createDraftStore', () => ({ loadDraft: jest.fn().mockResolvedValue(null), saveDraft: jest.fn().mockResolvedValue(undefined), clearDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/generationSubmit', () => ({ ...jest.requireActual('../src/lib/generationSubmit'), createGenerationSubmit: () => ({ run: mockRun }) }));
jest.mock('../src/components/CharacterPanel', () => ({ CharacterPanel: jest.fn(() => null) }));
jest.mock('../src/components/CameraPanel', () => ({ CameraPanel: () => null }));
jest.mock('../src/components/SourcePicker', () => ({ SourcePicker: () => null }));
jest.mock('../src/components/AttachFromDevice', () => ({ AttachFromDevice: () => null }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const video: CatalogModel = { id: 'wan-2.5-kie', name: 'Wan', modality: 'text-to-video', credits: 2, gated: false, durations: [5,10], capabilities: { inputs: { prompt: { max: 800 }, aspect: { values: ['9:16','16:9'] } } } };
const input = () => root.container.queryAll(n => n.props.accessibilityLabel === t('mobile.prompt'))[0];
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockReplace.mockClear(); mockRun.mockReset().mockImplementation(async (_api: unknown, _request: unknown, _count: number, onStarted?: (n: number) => void, onJob?: (id: string, index: number) => void) => { onStarted?.(1); onJob?.('job', 0); return 'job'; }); jest.mocked(CharacterPanel).mockClear();
    mockParams = { modelId: video.id, prompt: 'A quiet original scene', duration: '5' };
    jest.mocked(fetchCatalog).mockResolvedValue([video]);
});
afterEach(async () => { await act(async () => root.unmount()); });
const render = async () => act(async () => root.render(<Create />));
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
test.each(['faceless-reel','faceless-sound','oddlings'])('%s does not pre-tick source rights', async recipe => {
    jest.mocked(fetchCatalog).mockResolvedValue([{ ...video, capabilities: { ...video.capabilities, media: { video: { required:true } } } }]);
    handoff({ references:[{ slot:'video',origin:'asset',asset_id:'source-job' }] },recipe); await render();
    const rights = root.container.queryAll(n => n.props.accessibilityLabel === english('form.sourceRights'))[0];
    expect(rights.props.accessibilityState.checked).toBe(false);
});
