import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Conversation from '../src/app/(app)/chat/[id]';
import { appCache, bindCacheUser, wipeCache } from '../src/lib/appCache';
import { createMemoryStorage } from '../src/lib/cache';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockApi = { request: jest.fn() };
let mockGeneration = 0;
const mockChat = { getThread: jest.fn(), listModelsWithLimits: jest.fn(), listModels: jest.fn(), updateThread: jest.fn(), sendMessage: jest.fn(), createThread: jest.fn(), closeSend: jest.fn(), getJob: jest.fn() };
jest.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-1234-1234-123456789abc' }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: 'thread' }) }));
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
const loaded = { thread: { id: 'thread', title: 'Recovered title', model_id: 'm1', system_prompt: '', pinned: false }, messages: [] };
let root: Root;
const storage = createMemoryStorage(), docs = createMemoryStorage();
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const present = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const retry = () => root.container.queryAll(n => n.props.accessibilityLabel === t('chat.tryagain'))[0];

beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); mockGeneration = 0;
    [mockApi.request, ...Object.values(mockChat)].forEach(mock => mock.mockReset());
    await wipeCache(appCache, docs); await bindCacheUser('A', appCache, storage, docs); root = createRoot();
    mockApi.request.mockResolvedValue({ enabled: true, left: { m1: 2 } });
    mockChat.listModelsWithLimits.mockResolvedValue({ models: [model], max_attachments: 4 });
});
afterEach(async () => { await act(async () => root.unmount()); });

test('QA-E2: a chat that failed to load (expired session) offers Try again and recovers without a restart', async () => {
    mockChat.getThread.mockRejectedValueOnce(new ApiError(401, 'not_authenticated')).mockResolvedValueOnce(loaded);
    await act(async () => root.render(<Conversation />));
    expect(present(t('chat.couldnotloadthischat'))).toBe(true);
    expect(retry()).toBeDefined();
    await act(async () => retry().props.onClick(event));
    expect(mockChat.getThread).toHaveBeenCalledTimes(2);
    expect(present(t('chat.couldnotloadthischat'))).toBe(false);
    expect(retry()).toBeUndefined();
});

test('QA-E2: a new session generation reloads the chat on its own', async () => {
    mockChat.getThread.mockRejectedValueOnce(new ApiError(401, 'not_authenticated')).mockResolvedValueOnce(loaded);
    await act(async () => root.render(<Conversation />));
    expect(present(t('chat.couldnotloadthischat'))).toBe(true);
    mockGeneration = 1;
    await act(async () => root.render(<Conversation />));
    expect(mockChat.getThread).toHaveBeenCalledTimes(2);
    expect(present(t('chat.couldnotloadthischat'))).toBe(false);
});
