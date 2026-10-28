import { act } from 'react';
import { ApiError } from '../src/lib/api';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Conversation from '../src/app/(app)/chat/[id]';
import { oddlingChatInstructions, parseOddlingInstructions, nextOddlingInstructions } from '../src/lib/oddlingsChat';
import { useChatFreeLeft } from '../src/lib/useChatFreeLeft';
import { appCache, bindCacheUser, wipeCache } from '../src/lib/appCache';
import { createMemoryStorage } from '../src/lib/cache';
import { readDraft, writeDraft, toggleStar, forgetThread } from '../src/lib/chatLocal';
import { askAboutHref } from '../src/lib/nextSteps';
import { t, plural } from '../src/lib/i18n';
import { selectedSkillIds, skillById, skillsInstructions } from '../src/lib/studioSkills';
import { workflowById, workflowSteps } from '../src/lib/studioWorkflows';
const assetId = '12345678-1234-1234-1234-123456789abc';
const replyId = '22345678-1234-1234-1234-123456789abc';
let mockParams: any = { id: 'thread' };
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockApi = { request: jest.fn() };
const mockChat = { getThread: jest.fn(), listModelsWithLimits: jest.fn(), listModels: jest.fn(), updateThread: jest.fn(), sendMessage: jest.fn(), createThread: jest.fn(), closeSend: jest.fn(), getJob: jest.fn() };
const mockAsset = jest.fn(), mockStop = jest.fn(), mockFetch = jest.fn();
let mockSettings: any;
jest.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-1234-1234-123456789abc' }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => mockChat }));
jest.mock('../src/lib/chatStop', () => ({ ...jest.requireActual('../src/lib/chatStop'), resolveStoppedSend: (...args: any[]) => mockStop(...args) }));
jest.mock('../src/lib/chatLibrary', () => ({ ...jest.requireActual('../src/lib/chatLibrary'), fetchPersonas: async () => ({ personas: [] }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: () => mockFetch(), mediaApi: () => ({ getAsset: mockAsset }) }));
jest.mock('../src/lib/network', () => ({ ...jest.requireActual('../src/lib/network'), ensureOnline: async () => undefined }));
jest.mock('../src/components/chat/MakePanel', () => ({ MakePanel: () => null }));
jest.mock('../src/components/chat/LibraryImagePicker', () => ({ LibraryImagePicker: () => null }));
jest.mock('../src/components/chat/ChatSettings', () => ({ ChatSettings: (props: any) => { mockSettings = props; return jest.requireActual('react').createElement(jest.requireActual('../src/components/chat/ChatSettings').ChatSettings, props); } }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.ScrollView, RN.FlatList, RN.ActivityIndicator];
const model = { id: 'm1', name: 'Model', maker_label: 'Maker', credits_per_reply: 2, gated: false, options: { images: { extra_credits: 1 }, thinking: { extra_credits: 2 } } };
let root: Root;
const storage = createMemoryStorage(), docs = createMemoryStorage();
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { await act(async () => control(label).props.onClick(event)); };
const type = async (text: string) => { await act(async () => control(t('chat.composer.message')).props.onChangeText(text)); };
const textPresent = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const threadResult = (prompt = '', messages: any[] = []) => ({ thread: { id: 'thread', title: 'Thread', model_id: 'm1', system_prompt: prompt, pinned: false }, messages });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); [mockApi.request, ...Object.values(mockChat), mockAsset, mockStop].forEach(mock => mock.mockReset()); mockParams = { id: 'thread' };
    await wipeCache(appCache, docs); await bindCacheUser('A', appCache, storage, docs); root = createRoot();
    mockApi.request.mockResolvedValue({ enabled: true, left: { m1: 2 } });
    mockFetch.mockReset().mockResolvedValue([]);
    mockChat.getThread.mockResolvedValue(threadResult()); mockChat.listModelsWithLimits.mockResolvedValue({ models: [model, { ...model, id: 'm2', name: 'Second' }], max_attachments: 4 });
    mockChat.listModels.mockResolvedValue([model]); mockChat.createThread.mockResolvedValue({ id: 'thread' });
    mockChat.updateThread.mockImplementation(async (_id, patch) => ({ ...threadResult().thread, ...patch }));
    mockChat.sendMessage.mockResolvedValue({}); mockAsset.mockResolvedValue({ url: 'https://example.com/image.jpg', mime_type: 'image/jpeg' });
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });

const input = { picks: { oddling_name: 'Pip', hair: 'Bald' }, scene: 'A tiny stage' };
const launched = oddlingChatInstructions(input, []);
const canon = parseOddlingInstructions(launched)!.canon;
const skillLabel = (id: string) => { const skill = skillById(id)!; return `${skill.name}. ${skill.blurb}`; };
async function render(prompt = launched) { mockChat.getThread.mockResolvedValue(threadResult(prompt)); await act(async () => root.render(<Conversation />)); }
function expectCanon() {
    const prompt = mockChat.updateThread.mock.calls.at(-1)![1].system_prompt;
    expect(parseOddlingInstructions(prompt)).toMatchObject({ canon, skillIds: expect.arrayContaining(['oddling-continuity']) });
    expect(parseOddlingInstructions(prompt)!.skillIds[0]).toBe('oddling-continuity');
}
test('Storyboard is selected; toggling preserves canon, and Model picker is locked', async () => {
    await render(); expect(control(skillLabel('storyboard')).props.accessibilityState.selected).toBe(true);
    await press(skillLabel('storyboard')); expectCanon();
    expect(control(skillLabel('storyboard')).props.accessibilityState.selected).toBe(false);
    mockChat.updateThread.mockClear(); await press(skillLabel('model-picker'));
    expect(mockChat.updateThread).not.toHaveBeenCalled(); expect(textPresent(t('oddlingsStudio.chatSkillLocked'))).toBe(true);
});
test('old-format threads still toggle with the existing formatter', async () => {
    await render(skillsInstructions([skillById('storyboard')!]));
    await press(skillLabel('prompt-writer'));
    const prompt = mockChat.updateThread.mock.calls[0][1].system_prompt;
    expect(prompt).toBe(skillsInstructions([skillById('storyboard')!, skillById('prompt-writer')!], []));
});
test('two toggles survive a failed first catalog with no newline after Models', async () => {
    const removed = nextOddlingInstructions(launched, 'storyboard', []);
    if (!removed || !('instructions' in removed)) throw Error('fixture');
    await render(removed.instructions);
    mockFetch.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce([{ id: 'image', name: 'Image', modality: 'text-to-image', credits: 6, gated: false, durations: [], capabilities: { inputs: { prompt: {} } } }]);
    await press(skillLabel('storyboard')); expectCanon();
    expect(control(skillLabel('storyboard')).props.accessibilityState.selected).toBe(true);
    expect(mockChat.updateThread.mock.calls[0][1].system_prompt.endsWith('Models (id|kind|Credits per generation):')).toBe(true);
    await press(skillLabel('storyboard')); expectCanon();
    expect(control(skillLabel('storyboard')).props.accessibilityState.selected).toBe(false);
});
test('Oddling settings are read-only, save a model alone and reject injected prompt patches', async () => {
    await render(); await press(t('chat.settings.open'));
    expect(mockSettings.instructionsLocked).toBe(true); expect(textPresent(t('oddlingsStudio.instructionsLocked'))).toBe(true);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('chat.settings.instructions'))).toHaveLength(0);
    expect(root.container.queryAll(n => !!n.props.selectable && n.children.includes(launched))).toHaveLength(1);
    await act(async () => mockSettings.onSave({ system_prompt: '' })); expect(mockChat.updateThread).not.toHaveBeenCalled();
    const second = root.container.queryAll(n => n.props.accessibilityRole === 'radio' && n.queryAll(c => c.children.includes('Second')).length > 0)[0];
    await act(async () => second.props.onClick(event)); await press(t('chat.settings.save'));
    expect(mockChat.updateThread).toHaveBeenLastCalledWith('thread', { model_id: 'm2' });
});
test('ordinary settings remain editable and submit changed instructions', async () => {
    await render('Ordinary instructions'); await press(t('chat.settings.open'));
    const field = control(t('chat.settings.instructions')); expect(field).toBeDefined();
    await act(async () => field.props.onChangeText('New instructions')); await press(t('chat.settings.save'));
    expect(mockChat.updateThread).toHaveBeenLastCalledWith('thread', { system_prompt: 'New instructions' });
});

test('hand-off continuity is selected and disabled and cannot patch the thread', async () => {
    await render();
    expect(control(skillLabel('oddling-continuity')).props.accessibilityState).toMatchObject({ selected: true, disabled: true });
    await press(skillLabel('oddling-continuity'));
    expect(mockChat.updateThread).not.toHaveBeenCalled();
});
test('ordinary chat can toggle continuity freely', async () => {
    await render(skillsInstructions([skillById('storyboard')!]));
    expect(control(skillLabel('oddling-continuity')).props.accessibilityState.disabled).toBe(false);
    await press(skillLabel('oddling-continuity'));
    expect(selectedSkillIds(mockChat.updateThread.mock.calls[0][1].system_prompt)).toEqual(['storyboard', 'oddling-continuity']);
    expect(parseOddlingInstructions(mockChat.updateThread.mock.calls[0][1].system_prompt)).toBeNull();
});
