import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Conversation from '../src/app/(app)/chat/[id]';
import { appCache, bindCacheUser, wipeCache } from '../src/lib/appCache';
import { createMemoryStorage } from '../src/lib/cache';
import { t } from '../src/lib/i18n';
import { bindMusicLyricThread, MUSIC_LYRIC_BEGIN, MUSIC_LYRIC_END, resetMusicLyricHandoffsForTest, selectMusicLyricPersona, stageMusicLyricHandoff } from '../src/lib/music/lyricAssistantHandoff';
import { skillById } from '../src/lib/studioSkills';

const mockRouter = { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() };
let mockParams: Record<string, string> = { id: 'thread' };
const mockApi = { request: jest.fn() };
let mockGeneration = 0;
const mockChat = { getThread: jest.fn(), listModelsWithLimits: jest.fn(), listModels: jest.fn(), updateThread: jest.fn(), sendMessage: jest.fn(), createThread: jest.fn(), closeSend: jest.fn(), getJob: jest.fn() };
jest.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-1234-1234-123456789abc' }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, generation: mockGeneration }) }));
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => mockChat }));
jest.mock('../src/lib/chatLibrary', () => ({ ...jest.requireActual('../src/lib/chatLibrary'), fetchPersonas: async () => ({ personas: [] }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [] }));
jest.mock('../src/lib/network', () => ({ ...jest.requireActual('../src/lib/network'), ensureOnline: async () => undefined }));
jest.mock('../src/components/chat/MakePanel', () => ({ MakePanel: () => null }));
jest.mock('../src/components/chat/LibraryImagePicker', () => ({ LibraryImagePicker: () => null }));
jest.mock('../src/components/chat/ChatSettings', () => ({ ChatSettings: () => null }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.ScrollView, RN.FlatList, RN.ActivityIndicator];

const model = { id: 'm1', name: 'Model', maker_label: 'Maker', credits_per_reply: 2, gated: false, options: {} };
const loaded = { thread: { id: 'thread', title: 'Thread', model_id: 'm1', system_prompt: '', pinned: false }, messages: [
    { id: 'user', role: 'user', content: 'Old question' },
    { id: '22345678-1234-1234-1234-123456789abc', role: 'assistant', content: 'Starred answer', status: 'complete', credits: 0 },
] };
let root: Root;
const storage = createMemoryStorage(), docs = createMemoryStorage();
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { await act(async () => control(label).props.onClick(event)); };

beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); mockGeneration = 0;
    mockParams = { id: 'thread' }; resetMusicLyricHandoffsForTest();
    [mockApi.request, ...Object.values(mockChat)].forEach(mock => mock.mockReset());
    await wipeCache(appCache, docs); await bindCacheUser('A', appCache, storage, docs); root = createRoot();
    mockApi.request.mockResolvedValue({ enabled: true, left: { m1: 2 } });
    mockChat.listModelsWithLimits.mockResolvedValue({ models: [model], max_attachments: 4 });
});
afterEach(async () => { await act(async () => root.unmount()); resetMusicLyricHandoffsForTest(); });

test('sending from starred replies reveals the new user and pending assistant messages', async () => {
    let finish!: (result: object) => void;
    mockChat.getThread.mockResolvedValue(loaded);
    mockChat.sendMessage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(<Conversation />));
    await press(t('chatDepth.starLabel'));
    await press(t('chatDepth.showStarred'));
    expect(control('You: Old question')).toBeUndefined();
    expect(control('Assistant: Starred answer')).toBeDefined();
    expect(control(t('chatDepth.showAll')).props.accessibilityState.selected).toBe(true);

    await act(async () => control(t('chat.composer.message')).props.onChangeText('New question'));
    await press(t('chatDepth.sendFree'));
    expect(mockChat.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockChat.sendMessage.mock.calls[0][1]).toBe('New question');
    expect(control(t('chatDepth.showAll'))).toBeUndefined();
    expect(control(t('chatDepth.showStarred')).props.accessibilityState.selected).toBe(false);
    expect(control('You: New question')).toBeDefined();
    expect(control(`Assistant: ${t('chat.writing')}`)).toBeDefined();
    await act(async () => finish({}));
});
test('a bound completed Lyricist reply returns to the existing Music screen and keeps its one-time seed stable', async () => {
    const token = stageMusicLyricHandoff({ draftId: null, draftRevision: 0, sourceLyrics: 'Old words', lyricLimit: 3000, request: 'Make it vivid.' })!;
    selectMusicLyricPersona(token, 'persona'); bindMusicLyricThread(token, 'persona', 'thread');
    mockParams = { id: 'thread', lyricHandoff: token };
    mockChat.getThread.mockResolvedValue({ ...loaded, messages: [
        { id: 'user', role: 'user', content: 'Request' },
        { id: 'assistant', role: 'assistant', status: 'complete', credits: 2,
            content: `${MUSIC_LYRIC_BEGIN}\nNew words\n${MUSIC_LYRIC_END}` },
    ] });
    await act(async () => root.render(<Conversation />));
    expect(control(t('chat.composer.message')).props.value).toContain('Make it vivid.');
    resetMusicLyricHandoffsForTest();
    await act(async () => root.render(<Conversation />));
    expect(control(t('chat.composer.message')).props.value).toContain('Make it vivid.');
    // Re-stage for the return action because clearing above deliberately invalidated the first token.
    const returnToken = stageMusicLyricHandoff({ draftId: null, draftRevision: 0, sourceLyrics: 'Old words', lyricLimit: 3000, request: 'Make it vivid.' })!;
    selectMusicLyricPersona(returnToken, 'persona'); bindMusicLyricThread(returnToken, 'persona', 'thread');
    mockParams = { id: 'thread', lyricHandoff: returnToken };
    await act(async () => { root.unmount(); root = createRoot(); root.render(<Conversation />); });
    await press(t('music.lyricAssistant.reviewInMusic'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({ pathname: '/music/create', params: { lyricHandoff: returnToken } });
});
test('a Music token bound to another thread never seeds or offers return', async () => {
    const token = stageMusicLyricHandoff({ draftId: null, draftRevision: 0, sourceLyrics: 'Old words', lyricLimit: 3000, request: 'Make it vivid.' })!;
    selectMusicLyricPersona(token, 'persona'); bindMusicLyricThread(token, 'persona', 'thread');
    mockParams = { id: 'other-thread', lyricHandoff: token };
    mockChat.getThread.mockResolvedValue({ ...loaded, thread: { ...loaded.thread, id: 'other-thread' }, messages: [
        { id: 'assistant', role: 'assistant', status: 'complete', credits: 2, content: `${MUSIC_LYRIC_BEGIN}\nNew\n${MUSIC_LYRIC_END}` },
    ] });
    await act(async () => root.render(<Conversation />));
    expect(control(t('music.lyricAssistant.reviewInMusic'))).toBeUndefined();
    expect(control(t('chat.composer.message')).props.value).toBe('');
});
test('a Lyricist conversation locks Studio skills so the private profile prompt cannot be replaced', async () => {
    const token = stageMusicLyricHandoff({ draftId: null, draftRevision: 0, sourceLyrics: 'Old words', lyricLimit: 3000, request: 'Make it vivid.' })!;
    selectMusicLyricPersona(token, 'persona'); bindMusicLyricThread(token, 'persona', 'thread');
    mockParams = { id: 'thread', lyricHandoff: token };
    mockChat.getThread.mockResolvedValue({ ...loaded, messages: [] });
    await act(async () => root.render(<Conversation />));
    const skill = skillById('storyboard')!;
    const skillControl = control(`${skill.name}. ${skill.blurb}`);
    expect(skillControl.props.accessibilityState.disabled).toBe(true);
    await act(async () => skillControl.props.onClick(event));
    expect(mockChat.updateThread).not.toHaveBeenCalled();
});
