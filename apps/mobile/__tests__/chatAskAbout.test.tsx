import { act } from 'react';
import { ApiError } from '../src/lib/api';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Conversation from '../src/app/(app)/chat/[id]';
import NewChat from '../src/app/(app)/chat/new';
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
const mockAsset = jest.fn(), mockStop = jest.fn();
let mockSettings: any;
jest.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-1234-1234-123456789abc' }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => mockChat }));
jest.mock('../src/lib/chatStop', () => ({ ...jest.requireActual('../src/lib/chatStop'), resolveStoppedSend: (...args: any[]) => mockStop(...args) }));
jest.mock('../src/lib/chatLibrary', () => ({ ...jest.requireActual('../src/lib/chatLibrary'), fetchPersonas: async () => ({ personas: [] }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [], mediaApi: () => ({ getAsset: mockAsset }) }));
jest.mock('../src/lib/network', () => ({ ...jest.requireActual('../src/lib/network'), ensureOnline: async () => undefined }));
jest.mock('../src/components/chat/MakePanel', () => ({ MakePanel: () => null }));
jest.mock('../src/components/chat/LibraryImagePicker', () => ({ LibraryImagePicker: () => null }));
jest.mock('../src/components/chat/ChatSettings', () => ({ ChatSettings: (props: any) => { mockSettings = props; return null; } }));
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
    mockChat.getThread.mockResolvedValue(threadResult()); mockChat.listModelsWithLimits.mockResolvedValue({ models: [model], max_attachments: 4 });
    mockChat.listModels.mockResolvedValue([model]); mockChat.createThread.mockResolvedValue({ id: 'thread' });
    mockChat.updateThread.mockImplementation(async (_id, patch) => ({ ...threadResult().thread, ...patch }));
    mockChat.sendMessage.mockResolvedValue({}); mockAsset.mockResolvedValue({ url: 'https://example.com/image.jpg', mime_type: 'image/jpeg' });
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
test('conversation restores and debounces its draft, offers free send only without options', async () => {
    await writeDraft('thread', 'saved'); await act(async () => root.render(<Conversation />));
    expect(control(t('chat.composer.message')).props.value).toBe('saved'); expect(control(t('chatDepth.sendFree'))).toBeDefined();
    await press(`${t('chat.opt.thinking')}, ${plural('chat.opt.extraSpoken', 2)}`);
    expect(control(plural('chat.sendPrice', 4))).toBeDefined();
    jest.useFakeTimers(); await type('edited'); expect(await readDraft('thread')).toBe('saved');
    await act(async () => { jest.advanceTimersByTime(400); }); expect(await readDraft('thread')).toBe('edited');
});
test('post-send allowance refresh gates the last free label and old responses are ignored', async () => {
    const during = deferred<any>(), settled = deferred<any>();
    mockApi.request.mockResolvedValueOnce({ enabled: true, left: { m1: 1 } }).mockReturnValueOnce(during.promise).mockReturnValueOnce(settled.promise);
    await act(async () => root.render(<Conversation />)); await type('hello'); await press(t('chatDepth.sendFree'));
    expect(control(plural('chat.sendPrice', 2))).toBeDefined(); expect(control(t('chatDepth.sendFree'))).toBeUndefined();
    await act(async () => during.resolve({ enabled: true, left: { m1: 1 } })); expect(control(t('chatDepth.sendFree'))).toBeUndefined();
    await act(async () => settled.resolve({ enabled: true, left: {} })); expect(control(plural('chat.sendPrice', 2))).toBeDefined();
});
test('allowance hook ignores an older round and failures show prices', async () => {
    const first = deferred<any>(); let shown!: ReturnType<typeof useChatFreeLeft>;
    mockApi.request.mockReturnValueOnce(first.promise).mockRejectedValueOnce(Error('offline'));
    function Hook({ round }: { round: number }) { shown = useChatFreeLeft(mockApi as any, round); return null; }
    await act(async () => root.render(<Hook round={0} />)); await act(async () => root.render(<Hook round={1} />));
    expect(shown).toEqual({ left: {}, loadedFor: 1 });
    await act(async () => first.resolve({ enabled: true, left: { m1: 9 } })); expect(shown).toEqual({ left: {}, loadedFor: 1 });
});
test('starred bar filters replies, handles empty filter and disappears after last unstar', async () => {
    mockChat.getThread.mockResolvedValue(threadResult('', [{ id: 'user', role: 'user', content: 'Question' }, { id: replyId, role: 'assistant', content: 'Answer', status: 'complete', credits: 0 }]));
    await act(async () => root.render(<Conversation />)); expect(control(t('chatDepth.showStarred'))).toBeUndefined();
    await press(t('chatDepth.starLabel')); await press(t('chatDepth.showStarred'));
    expect(control('You: Question')).toBeUndefined(); expect(control('Assistant: Answer')).toBeDefined();
    await press(t('chatDepth.unstarLabel')); expect(control(t('chatDepth.showAll'))).toBeUndefined(); expect(control('You: Question')).toBeDefined();
    await act(async () => root.unmount()); await toggleStar('thread', 'gone'); root = createRoot();
    await act(async () => root.render(<Conversation />)); await press(t('chatDepth.showStarred')); expect(textPresent(t('chatDepth.noStars'))).toBe(true);
});
test('Android manage menu retains its existing four actions', async () => {
    const original = RN.Platform.OS; Object.defineProperty(RN.Platform, 'OS', { value: 'android', configurable: true });
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => undefined);
    try { await act(async () => root.render(<Conversation />)); await press(t('chat.workspace.manage')); expect(alert.mock.calls[0][2]).toHaveLength(4); }
    finally { alert.mockRestore(); Object.defineProperty(RN.Platform, 'OS', { value: original, configurable: true }); }
});
test.each(['image', 'video', 'error', 'invalid', 'unsupported'])('Ask about this: %s', async kind => {
    mockParams = { id: 'thread', asset: kind === 'invalid' ? 'bad-id' : assetId };
    if (kind === 'video') mockAsset.mockResolvedValue({ url: 'https://example.com/clip', mime_type: 'video/mp4' });
    if (kind === 'error') mockAsset.mockRejectedValue(Error('expired'));
    if (kind === 'unsupported') mockChat.listModelsWithLimits.mockResolvedValue({ models: [{ ...model, options: {} }] });
    await act(async () => root.render(<Conversation />));
    expect(mockChat.sendMessage).not.toHaveBeenCalled();
    if (kind === 'image') {
        expect(mockAsset).toHaveBeenCalledTimes(1); expect(control(t('chat.attach.removeN', { n: '1' }))).toBeDefined();
        await type('image question'); await press(plural('chat.sendPrice', 3));
        expect(mockChat.sendMessage.mock.calls[0][6]).toEqual([{ source_asset: assetId }]);
    } else if (kind === 'invalid' || kind === 'unsupported') expect(mockAsset).not.toHaveBeenCalled();
    if (kind === 'video') expect(textPresent(t('chatDepth.imagesOnly'))).toBe(true);
    if (kind === 'error') expect(textPresent(t('chatDepth.imageExpired'))).toBe(true);
    if (kind === 'unsupported') expect(textPresent(t('chatDepth.noImageModel'))).toBe(true);
});
test.each([assetId, 'bad-id'])('new chat forwards only UUID asset %s', async asset => {
    mockParams = { asset }; await act(async () => root.render(<NewChat />));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'thread', ...(asset === assetId ? { asset } : {}) } });
    expect(askAboutHref(assetId)).toEqual({ pathname: '/chat/new', params: { asset: assetId } });
});
test.each([false, true])('late stopped-send give-back after unmount (deleted=%s)', async deleted => {
    const outcome = deferred<string>(); mockStop.mockReturnValue(outcome.promise);
    mockChat.sendMessage.mockImplementation((_id, _text, _key, _events, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))));
    await act(async () => root.render(<Conversation />)); await type('unsent again'); await press(t('chatDepth.sendFree'));
    expect(control(t('chat.composer.message')).props.value).toBe('');
    await act(async () => root.unmount()); if (deleted) await forgetThread('thread');
    await act(async () => outcome.resolve('nothing'));
    expect(await readDraft('thread')).toBe(deleted ? '' : 'unsent again');
    root = createRoot(); await act(async () => root.render(<Conversation />)); expect(control(t('chat.composer.message')).props.value).toBe(deleted ? '' : 'unsent again');
});
test('workflow selection derives from saved instructions; settings clears it and failed toggles roll back', async () => {
    const picks = workflowSteps(workflowById('viral-short')!);
    mockChat.getThread.mockResolvedValue(threadResult(skillsInstructions(picks)));
    await act(async () => root.render(<Conversation />));
    for (const skill of picks) expect(control(`${skill.name}. ${skill.blurb}`).props.accessibilityState.selected).toBe(true);
    expect(control(t('chat.composer.message')).props.placeholder).toBe(picks[0].starter);
    const fifth = skillById('model-picker')!; expect(control(`${fifth.name}. ${fifth.blurb}`).props.accessibilityState.disabled).toBe(true);
    mockChat.updateThread.mockRejectedValueOnce(Error('failed')); await press(`${picks[0].name}. ${picks[0].blurb}`);
    expect(control(`${picks[0].name}. ${picks[0].blurb}`).props.accessibilityState.selected).toBe(true); expect(textPresent(t('chat.skills.failed'))).toBe(true);
    await press(`${picks[0].name}. ${picks[0].blurb}`);
    expect(selectedSkillIds(mockChat.updateThread.mock.calls.at(-1)![1].system_prompt)).toEqual(picks.slice(1).map(s => s.id));
    await press(t('chat.settings.open'));
    await act(async () => mockSettings.onSave({ system_prompt: 'Custom instructions' }));
    for (const skill of picks) expect(control(`${skill.name}. ${skill.blurb}`).props.accessibilityState.selected).toBe(false);
});

test.each(['insufficient_balance', 'insufficient_credits'])('chat refusal %s restores text and offers native top-up', async code => {
    mockChat.sendMessage.mockRejectedValue(new ApiError(402, code));
    await act(async () => root.render(<Conversation />));
    expect(control(t('lowBalance.buy'))).toBeUndefined();
    await type('keep my question'); await press(t('chatDepth.sendFree'));
    expect(textPresent(t('chat.notenoughcreditsforthisreply'))).toBe(true);
    expect(control(t('chat.composer.message')).props.value).toBe('keep my question');
    await press(t('lowBalance.buy')); expect(mockRouter.push).toHaveBeenCalledWith('/credits');
    mockChat.sendMessage.mockRejectedValueOnce(new ApiError(429, 'rate_limited'));
    await press(t('chatDepth.sendFree'));
    expect(textPresent(t('chat.toomanymessagesWaitamoment'))).toBe(true);
    expect(control(t('lowBalance.buy'))).toBeUndefined();
});
