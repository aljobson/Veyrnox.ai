import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import NewChat, { PERSONA_WAIT_MS } from '../src/app/(app)/chat/new';
import { t } from '../src/lib/i18n';
import { SKILL_MODEL } from '../src/lib/studioSkills';
const mockRouter = { push: jest.fn(), replace: jest.fn() }, mockApi = {};
const mockModels = jest.fn(), mockCreate = jest.fn(), mockDelete = jest.fn(), mockPersonas = jest.fn(), mockStart = jest.fn();
const mockValidHandoff = jest.fn(), mockSelectPersona = jest.fn(), mockBindThread = jest.fn();
let mockParams: any = {};
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => ({ listModels: mockModels, createThread: mockCreate, deleteThread: mockDelete }) }));
jest.mock('../src/lib/chatLibrary', () => ({ ...jest.requireActual('../src/lib/chatLibrary'), fetchPersonas: (...args: any[]) => mockPersonas(...args), startFromPersona: (...args: any[]) => mockStart(...args) }));
jest.mock('../src/lib/music/lyricAssistantHandoff', () => ({
    isMusicLyricHandoff: (...args: any[]) => mockValidHandoff(...args),
    selectMusicLyricPersona: (...args: any[]) => mockSelectPersona(...args),
    bindMusicLyricThread: (...args: any[]) => mockBindThread(...args),
}));
void [RN.View, RN.Text, RN.Pressable, RN.FlatList, RN.ScrollView, RN.ActivityIndicator];
const model = { id: SKILL_MODEL, name: 'Default', credits_per_reply: 3, gated: false };
const persona = { id: 'persona', name: 'Editor', instructions: 'Be helpful', modelId: 'persona-model' };
const asset = '12345678-1234-1234-1234-123456789abc';
let root: Root;
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { await act(async () => control(label).props.onClick({ nativeEvent: {} })); };
const render = async () => { await act(async () => root.render(<NewChat />)); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot(); mockParams = {};
    mockModels.mockReset().mockResolvedValue([{ ...model, id: 'other' }, model]);
    mockCreate.mockReset().mockResolvedValue({ id: 'thread' }); mockDelete.mockReset().mockResolvedValue(undefined);
    mockPersonas.mockReset().mockResolvedValue({ enabled: true, personas: [persona] }); mockStart.mockReset().mockResolvedValue('persona-thread');
    mockValidHandoff.mockReset().mockReturnValue(true); mockSelectPersona.mockReset().mockReturnValue(true); mockBindThread.mockReset().mockReturnValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
test.each([asset, 'invalid'])('persona chooser waits for a choice and forwards only UUID asset %s', async value => {
    mockParams = { asset: value }; await render();
    expect(mockCreate).not.toHaveBeenCalled(); expect(mockStart).not.toHaveBeenCalled();
    expect(control(t('skillsUi.blankChat'))).toBeDefined();
    await press(t('chat.startachatwiththepersona', { value1: persona.name }));
    expect(mockStart).toHaveBeenCalledWith(mockApi, persona, 'other');
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'persona-thread', ...(value === asset ? { asset } : {}) } });
});
test('Blank chat starts on SKILL_MODEL and forwards the asset', async () => {
    mockParams = { asset }; await render(); await press(t('skillsUi.blankChat'));
    expect(mockCreate).toHaveBeenCalledWith(SKILL_MODEL); expect(mockStart).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'thread', asset } });
});
test('Music Lyricist mode waits for and binds one private persona and exact thread', async () => {
    mockParams = { lyricHandoff: 'opaque-token' }; await render();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(control(t('skillsUi.blankChat'))).toBeUndefined();
    await press(t('music.lyricAssistant.chooseNamed', { name: persona.name }));
    expect(mockSelectPersona).toHaveBeenCalledWith('opaque-token', persona.id);
    expect(mockStart).toHaveBeenCalledWith(mockApi, persona, 'other');
    expect(mockBindThread).toHaveBeenCalledWith('opaque-token', persona.id, 'persona-thread');
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'persona-thread', lyricHandoff: 'opaque-token' } });
});
test('Music Lyricist mode keeps a long private-profile picker scrollable', async () => {
    mockParams = { lyricHandoff: 'opaque-token' };
    mockPersonas.mockResolvedValue({ enabled: true, personas: Array.from({ length: 20 }, (_, index) => ({
        ...persona, id: `persona-${index}`, name: `Editor ${index}`,
    })) });
    await render();
    expect(root.container.queryAll(n => n.props.keyboardShouldPersistTaps === 'handled').length).toBeGreaterThan(0);
    expect(control(t('music.lyricAssistant.manageProfiles'))).toBeDefined();
});
test.each([
    [{ enabled: false, personas: [] }, 'music.lyricAssistant.unavailable'],
    [{ enabled: true, personas: [] }, 'music.lyricAssistant.noProfiles'],
])('Music Lyricist mode distinguishes persona state %#', async (result, key) => {
    mockParams = { lyricHandoff: 'opaque-token' }; mockPersonas.mockResolvedValue(result); await render();
    expect(root.container.queryAll(n => n.children.includes(t(key))).length).toBeGreaterThan(0);
    expect(mockCreate).not.toHaveBeenCalled();
});
test('Music Lyricist mode deletes a half-created thread and stays put when binding fails', async () => {
    mockParams = { lyricHandoff: 'opaque-token' }; mockBindThread.mockReturnValue(false); await render();
    await press(t('music.lyricAssistant.chooseNamed', { name: persona.name }));
    expect(mockDelete).toHaveBeenCalledWith('persona-thread');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.children.includes(t('music.lyricAssistant.expired'))).length).toBeGreaterThan(0);
    expect(control(t('music.lyricAssistant.backToMusic'))).toBeDefined();
});
test('Music Lyricist mode cleans up and never routes when unmounted during persona start', async () => {
    const start = deferred<string>(); mockParams = { lyricHandoff: 'opaque-token' }; mockStart.mockReturnValue(start.promise); await render();
    await act(async () => { control(t('music.lyricAssistant.chooseNamed', { name: persona.name })).props.onClick({ nativeEvent: {} }); });
    await act(async () => root.unmount()); await act(async () => start.resolve('late-thread'));
    expect(mockDelete).toHaveBeenCalledWith('late-thread'); expect(mockBindThread).not.toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled();
    root = createRoot();
});
test('an invalid Music token fails closed instead of auto-starting a blank chat', async () => {
    mockValidHandoff.mockReturnValue(false); mockParams = { lyricHandoff: 'expired-token' }; await render();
    expect(root.container.queryAll(n => n.children.includes(t('music.lyricAssistant.expired'))).length).toBeGreaterThan(0);
    expect(mockCreate).not.toHaveBeenCalled(); expect(mockStart).not.toHaveBeenCalled();
});
test('Music Lyricist mode has no persona timeout fallback', async () => {
    jest.useFakeTimers(); const personas = deferred<any>(); mockParams = { lyricHandoff: 'opaque-token' }; mockPersonas.mockReturnValue(personas.promise);
    await render(); await act(async () => jest.advanceTimersByTime(PERSONA_WAIT_MS * 3));
    expect(mockCreate).not.toHaveBeenCalled(); expect(mockStart).not.toHaveBeenCalled();
});
test('Music Lyricist mode exposes a retry after profile fetch failure', async () => {
    mockParams = { lyricHandoff: 'opaque-token' }; mockPersonas.mockRejectedValueOnce(new Error('offline'));
    await render(); expect(control(t('music.lyricAssistant.retry'))).toBeDefined();
    mockPersonas.mockResolvedValue({ enabled: true, personas: [persona] }); await press(t('music.lyricAssistant.retry'));
    expect(control(t('music.lyricAssistant.chooseNamed', { name: persona.name }))).toBeDefined();
});
test.each(['empty', 'failed', 'pending'])('%s personas auto-start exactly once', async kind => {
    jest.useFakeTimers();
    if (kind === 'empty') mockPersonas.mockResolvedValue({ personas: [] });
    if (kind === 'failed') mockPersonas.mockRejectedValue(Error('offline'));
    if (kind === 'pending') mockPersonas.mockReturnValue(new Promise(() => {}));
    await render();
    if (kind === 'pending') { expect(mockCreate).not.toHaveBeenCalled(); await act(async () => jest.advanceTimersByTime(PERSONA_WAIT_MS - 1)); expect(mockCreate).not.toHaveBeenCalled(); }
    await act(async () => jest.advanceTimersByTime(PERSONA_WAIT_MS + 1)); await render();
    expect(mockCreate).toHaveBeenCalledTimes(1); expect(mockCreate).toHaveBeenCalledWith(SKILL_MODEL);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1); expect(control(t('skillsUi.blankChat'))).toBeUndefined();
});
test('wait begins when models load; personas arriving within it open the chooser', async () => {
    jest.useFakeTimers(); const models = deferred<any>(), personas = deferred<any>();
    mockModels.mockReturnValue(models.promise); mockPersonas.mockReturnValue(personas.promise); await render();
    expect(mockPersonas).toHaveBeenCalledTimes(1); expect(mockModels).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(5000)); expect(mockCreate).not.toHaveBeenCalled();
    await act(async () => models.resolve([model])); await act(async () => jest.advanceTimersByTime(1400));
    await act(async () => personas.resolve({ personas: [persona] })); await act(async () => jest.advanceTimersByTime(200));
    expect(mockCreate).not.toHaveBeenCalled(); expect(control(t('skillsUi.blankChat'))).toBeDefined();
});
test('a late persona result cannot replace an auto-start in flight', async () => {
    jest.useFakeTimers(); const personas = deferred<any>(), create = deferred<any>();
    mockPersonas.mockReturnValue(personas.promise); mockCreate.mockReturnValue(create.promise); await render();
    await act(async () => jest.advanceTimersByTime(PERSONA_WAIT_MS));
    await act(async () => personas.resolve({ personas: [persona] })); expect(control(t('skillsUi.blankChat'))).toBeUndefined();
    await act(async () => create.resolve({ id: 'thread' }));
    expect(mockCreate).toHaveBeenCalledTimes(1); expect(mockRouter.replace).toHaveBeenCalledTimes(1);
});
test('unmount before models resolve never creates a thread', async () => {
    const models = deferred<any>(); mockModels.mockReturnValue(models.promise); await render();
    await act(async () => root.unmount()); await act(async () => models.resolve([model]));
    expect(mockCreate).not.toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled(); root = createRoot();
});
test('unmount drops an in-flight creation response', async () => {
    const create = deferred<any>(); mockCreate.mockReturnValue(create.promise); mockPersonas.mockResolvedValue({ personas: [] }); await render();
    await act(async () => root.unmount()); await act(async () => create.resolve({ id: 'thread' }));
    expect(mockRouter.replace).not.toHaveBeenCalled(); root = createRoot();
});
