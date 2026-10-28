import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import NewChat, { PERSONA_WAIT_MS } from '../src/app/(app)/chat/new';
import { t } from '../src/lib/i18n';
import { SKILL_MODEL } from '../src/lib/studioSkills';
const mockRouter = { push: jest.fn(), replace: jest.fn() }, mockApi = {};
const mockModels = jest.fn(), mockCreate = jest.fn(), mockPersonas = jest.fn(), mockStart = jest.fn();
let mockParams: any = {};
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => ({ listModels: mockModels, createThread: mockCreate }) }));
jest.mock('../src/lib/chatLibrary', () => ({ ...jest.requireActual('../src/lib/chatLibrary'), fetchPersonas: (...args: any[]) => mockPersonas(...args), startFromPersona: (...args: any[]) => mockStart(...args) }));
void [RN.View, RN.Text, RN.Pressable, RN.FlatList, RN.ActivityIndicator];
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
    mockCreate.mockReset().mockResolvedValue({ id: 'thread' }); mockPersonas.mockReset().mockResolvedValue({ personas: [persona] }); mockStart.mockReset().mockResolvedValue('persona-thread');
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
