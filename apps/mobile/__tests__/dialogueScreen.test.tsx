import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { DialogueStudio } from '../src/components/dialogue/DialogueStudio';
import { buildDialogueRequest } from '../src/lib/speech/dialogue';
import { resolveDialogueCastAssignments } from '../src/lib/speech/dialogueShared';
import { ApiError } from '../src/lib/api';
import { createCache, createMemoryStorage, POLICIES } from '../src/lib/cache';
import type { CatalogModel } from '../src/lib/media';
import type { JobResult } from '../src/lib/createResult';
import { plural, t, setLocaleFromDevice } from '../src/lib/i18n';
import { rawText } from '../src/lib/i18n/translate';
import { OfflineError } from '../src/lib/network';
const mockRouter = { push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), back: jest.fn() };
const mockTitles: string[] = [];
const mockSavedList = jest.fn(), mockLoadCast = jest.fn(), mockSaveCast = jest.fn(), mockForgetCast = jest.fn();
let mockReopen: string | string[] | undefined;
const mockLoadCatalog = jest.fn();
const mockRequest = jest.fn(), mockRemember = jest.fn(), mockRefresh = jest.fn();
const mockApi = { request: mockRequest, getBalance: jest.fn(), stream: jest.fn() };
const mockModel: CatalogModel = { id: 'elevenlabs-dialogue', name: 'Dialogue', modality: 'text-to-speech', credits: 6, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
let mockCatalog: CatalogModel[], mockBalance: number | null, mockResult: JobResult, mockOwner: string;
const mockSubscribers = new Set<() => void>();
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), Stack: { Screen: ({ options }: { options: { title: string } }) => { mockTitles.push(options.title); return null; } }, useRouter: () => mockRouter }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockSubscribers.add(fn); return () => mockSubscribers.delete(fn); } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: () => mockLoadCatalog() }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => mockBalance }));
jest.mock('../src/lib/createResult', () => ({ useJobResult: () => mockResult, soundPassFor: () => null, refreshBalance: (...args: unknown[]) => mockRefresh(...args) }));
jest.mock('../src/lib/submittedRequests', () => ({ submittedRequests: { list: () => mockSavedList() }, rememberSubmitted: (...args: unknown[]) => mockRemember(...args) }));
jest.mock('../src/lib/speech/dialogueCastStore', () => ({ loadDialogueCast: () => mockLoadCast(), saveDialogueCast: (...args: unknown[]) => mockSaveCast(...args), forgetDialogueCastSpeakers: (...args: unknown[]) => mockForgetCast(...args) }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => {}, hasAgreed: async () => true } }));
jest.mock('../src/lib/celebrate', () => ({
    captureCelebrationAccount: () => jest.requireActual('../src/lib/celebrate').captureCelebrationAccount(),
    isCelebrationAccountCurrent: (token: unknown) => jest.requireActual('../src/lib/celebrate').isCelebrationAccountCurrent(token),
    noteLocalSubmission: jest.fn(), celebrateOutput: jest.fn() }));
jest.mock('../src/lib/milestoneHistory', () => ({ settleFirstMilestones: async () => {} }));
jest.mock('../src/lib/analytics/generations', () => ({ noteGenerationSubmitted: jest.fn() }));
jest.mock('../src/lib/generationProgress', () => ({ noteJobStarted: jest.fn() }));
jest.mock('../src/components/GenerationProgress', () => ({ GenerationProgress: () => null }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: (props: object) => jest.requireActual('react').createElement(jest.requireActual('react-native').View, { ...props, testID: 'dialogue-player' }) }));
jest.mock('../src/components/library/GeneratedChip', () => ({ GeneratedChip: () => null }));
jest.mock('../src/components/KeyboardScreen', () => ({ KeyboardScreen: jest.requireActual('react-native').View }));
jest.mock('../src/components/KeyboardFormScrollView', () => ({ KeyboardFormScrollView: jest.requireActual('react-native').View }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: jest.fn(() => ['screen', 'attempt', ++n].join('-')) }; });
void [RN.View, RN.Text, RN.TextInput, RN.StyleSheet, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
let root: Root;
const textOf = (node: TestInstance): string => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const button = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === rawText(label) && typeof node.props.onClick === 'function')[0];
const generate = () => button(plural('dialogue.generate', 6));
const click = async (node: TestInstance) => { await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); };
const render = async () => { await act(async () => root.render(<DialogueStudio reopen={mockReopen} />)); };
const write = async (value: string, number = 1) => {
    const input = root.container.queryAll(node => node.props.accessibilityLabel === t('dialogue.words', { number }) && typeof node.props.onChangeText === 'function')[0];
    await act(async () => input.props.onChangeText(value));
};
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    setLocaleFromDevice(['en']); mockTitles.length = 0; mockLoadCatalog.mockReset().mockImplementation(async () => mockCatalog);
    mockRouter.replace.mockClear(); mockRouter.back.mockClear(); mockRouter.canGoBack.mockReturnValue(false);
    mockOwner = 'a'; mockReopen = undefined; mockSavedList.mockReset().mockResolvedValue([]); mockLoadCast.mockReset().mockResolvedValue([]); mockSaveCast.mockReset().mockResolvedValue(undefined); mockForgetCast.mockReset().mockResolvedValue(undefined); mockCatalog = [mockModel]; mockBalance = 10;
    mockResult = { state: 'queued' }; mockRequest.mockReset().mockResolvedValue({ job_id: 'dialogue-job' });
    mockRemember.mockReset().mockResolvedValue(undefined); mockRefresh.mockReset(); mockRouter.push.mockClear();
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

const fill = async () => { await write('Hello'); await write('Hi', 2); };
test('catalog price, balance, shortfall and add-credits path', async () => {
    mockBalance = 2; await render(); await fill();
    expect(textOf(root.container)).toContain(plural('dialogue.price', 6));
    expect(textOf(root.container)).toContain(plural('dialogue.balance', 2));
    expect(textOf(root.container)).toContain(plural('dialogue.shortfall', 4));
    expect(generate().props.accessibilityState.disabled).toBe(true);
    await click(generate()); expect(mockRequest).not.toHaveBeenCalled();
    await click(button(t('dialogue.addCredits'))); expect(mockRouter.push).toHaveBeenCalledWith('/credits');
});
test.each([{ rows: [] }, { rows: [{ ...mockModel, gated: true }] }])('unavailable models keep the dialogue title and Audio recovery', async ({ rows }) => {
    mockCatalog = rows; await render(); expect(generate()).toBeUndefined();
    expect(textOf(root.container)).toContain(t('form.modelGone'));
    expect(mockTitles.at(-1)).toBe(t('dialogue.title'));
    await click(button(t('dialogue.back'))); expect(mockRouter.replace).toHaveBeenCalledWith('/audio');
});
test('loading catalog has no Generate; failed catalog has a translated error', async () => {
    let reject!: (error: Error) => void;
    mockLoadCatalog.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    await render(); expect(generate()).toBeUndefined();
    await act(async () => reject(new Error('offline')));
    expect(textOf(root.container)).toContain(t('form.modelLoad'));
});
test('empty, invalid and excessive text block Generate; clear returns to two empty turns', async () => {
    await render(); expect(generate().props.accessibilityState.disabled).toBe(true);
    await fill(); expect(generate().props.accessibilityState.disabled).toBe(false);
    await write('x'.repeat(1000)); expect(generate().props.accessibilityState.disabled).toBe(true);
    await click(button(t('dialogue.add')));
    await click(button(t('dialogue.clear')));
    expect(generate().props.accessibilityState.disabled).toBe(true);
    expect(button(t('dialogue.remove', { number: 1 })).props.accessibilityState.disabled).toBe(true);
});
test('accepted dialogue records history and renders the existing player; adjust resets', async () => {
    mockResult = { state: 'succeeded', job: { state: 'succeeded', credits: 6, model_id: mockModel.id }, asset: { url: 'https://dialogue.invalid/mock.mp3', mime_type: 'audio/mpeg' } };
    await render(); await fill(); await click(generate());
    expect(root.container.queryAll(node => node.props.testID === 'dialogue-player')[0].props.audio).toBe(true);
    expect(mockRemember).toHaveBeenCalledWith('dialogue-job', expect.objectContaining({ prompt: 'Ana: Hello\nBen: Hi', extraInputs: { dialogue_voice_1: 'Aria', dialogue_voice_2: 'Roger' } }), expect.anything(), expect.anything());
    expect(mockRefresh).toHaveBeenCalled();
    const firstKey = JSON.parse(mockRequest.mock.calls[0][1].body).idempotency_key;
    await click(button(t('dialogue.adjust'))); expect(generate()).toBeDefined();
    await write('New accepted job'); await click(generate());
    expect(JSON.parse(mockRequest.mock.calls[1][1].body).idempotency_key).not.toBe(firstKey);
});
test('queued result and refunded failure use shared result states', async () => {
    await render(); await fill(); await click(generate());
    expect(textOf(root.container)).toContain(t('dialogue.accepted'));
    mockResult = { state: 'failed', job: { state: 'failed', credits: 6, model_id: mockModel.id, refunded: true } };
    await render(); expect(textOf(root.container)).toMatch(/refund/i);
});
test.each(['reset', 'whitespace', 'revert'])('lost-response %s edit preserves the key and zero-balance reconciliation', async change => {
    mockRequest.mockRejectedValue(new ApiError(0, 'network'));
    await render(); await fill(); await click(generate());
    mockBalance = 0; await render();
    if (change === 'reset') await click(button(t('dialogue.resetCast')));
    if (change === 'whitespace') await write('  Hello \n ');
    if (change === 'revert') { await write('Changed'); await write('Hello'); }
    expect(generate().props.accessibilityState.disabled).toBe(false);
    await click(generate());
    const bodies = mockRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
    mockBalance = 10; await render(); await write('Actually different'); await click(generate());
    expect(JSON.parse(mockRequest.mock.calls[2][1].body).idempotency_key).not.toBe(bodies[0].idempotency_key);
});
test.each([new OfflineError(), new ApiError(400, 'consent_declined'), new ApiError(402, 'subscription_required')])('errors remain visible: %p', async error => {
    mockRequest.mockRejectedValueOnce(error);
    await render(); await fill(); await click(generate());
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
});
test('price_changed displays the new price and submits it only on the next press', async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(409, 'price_changed', { expected_credits: 8 }));
    await render(); await fill(); await click(generate());
    expect(mockRequest).toHaveBeenCalledTimes(1);
    await click(button(plural('dialogue.generate', 8)));
    expect(JSON.parse(mockRequest.mock.calls[1][1].body).confirmed_credits).toBe(8);
});
test('moving first appearance keeps voices; selecting an occupied voice swaps the cast', async () => {
    await render(); await fill();
    await click(button(t('dialogue.moveDown', { number: 1 })));
    await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'Roger' })));
    await click(generate());
    const inputs = JSON.parse(mockRequest.mock.calls[0][1].body).inputs;
    expect(inputs).toEqual({ prompt: 'Ben: Hi\nAna: Hello', dialogue_voice_1: 'Aria', dialogue_voice_2: 'Roger' });
});
test('submission locks all edits and ignores a repeated press', async () => {
    let release!: (value: unknown) => void;
    mockRequest.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await render(); await fill(); await click(generate());
    expect(button(t('dialogue.submitting')).props.accessibilityState.disabled).toBe(true);
    expect(button(t('dialogue.add')).props.accessibilityState.disabled).toBe(true);
    await click(button(t('dialogue.submitting'))); expect(mockRequest).toHaveBeenCalledTimes(1);
    await act(async () => release({ job_id: 'dialogue-job' }));
});
test('restore uses saved per-job cast, submits nothing, never persists preferences, and generates a fresh key', async () => {
    const turns = [{ speaker: 'Zoe', text: 'One' }, { speaker: 'Max', text: 'Two' }];
    const cast = [{ speaker: 'Zoe', voice: 'George' }, { speaker: 'Max', voice: 'Sarah' }];
    mockReopen = 'saved-job'; mockSavedList.mockResolvedValue([{ id: mockReopen, request: buildDialogueRequest(turns, cast, mockModel) }]);
    await render(); expect(mockRequest).not.toHaveBeenCalled(); expect(mockSaveCast).not.toHaveBeenCalled(); expect(mockLoadCast).toHaveBeenCalledTimes(1);
    await click(generate()); expect(JSON.parse(mockRequest.mock.calls[0][1].body).inputs).toEqual({ prompt: 'Zoe: One\nMax: Two', dialogue_voice_1: 'George', dialogue_voice_2: 'Sarah' });
    const first = JSON.parse(mockRequest.mock.calls[0][1].body).idempotency_key;
    mockReopen = 'second-job'; mockSavedList.mockResolvedValue([{ id: mockReopen, request: buildDialogueRequest(turns, cast, mockModel) }]);
    await render(); expect(mockRequest).toHaveBeenCalledTimes(1); await click(generate());
    expect(JSON.parse(mockRequest.mock.calls[1][1].body).idempotency_key).not.toBe(first);
});
test.each(['unknown', '../invalid', 'corrupt'])('bad restore %s opens empty with a note', async id => {
    mockReopen = id;
    if (id === 'corrupt') mockSavedList.mockResolvedValue([{ id, request: { modelId: mockModel.id, prompt: 'broken', extraInputs: { dialogue_voice_1: 'invalid' } } }]);
    await render(); expect(textOf(root.container)).toContain(t('dialogue.restoreUnavailable'));
    expect(generate().props.accessibilityState.disabled).toBe(true); expect(mockRequest).not.toHaveBeenCalled();
});
test('late restore and late cast reads cannot expose an old account', async () => {
    let release!: (value: unknown) => void;
    mockReopen = 'saved-job'; mockSavedList.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await render();
    await act(async () => { mockOwner = 'b'; mockSubscribers.forEach(fn => fn()); });
    const turns = [{ speaker: 'Private', text: 'Secret' }, { speaker: 'Other', text: 'Hidden' }];
    await act(async () => release([{ id: 'saved-job', request: buildDialogueRequest(turns, resolveDialogueCastAssignments(turns, []), mockModel) }]));
    expect(textOf(root.container)).not.toContain('Private'); expect(mockRequest).not.toHaveBeenCalled();
    expect(generate().props.accessibilityState.disabled).toBe(true);
});
test('late preference read never replaces a cast edited on screen', async () => {
    let release!: (value: unknown) => void;
    mockLoadCast.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await render(); await fill();
    await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'Sarah' })));
    await act(async () => release([{ speaker: 'Ana', voice: 'George' }]));
    await click(generate()); expect(JSON.parse(mockRequest.mock.calls[0][1].body).inputs.dialogue_voice_1).toBe('Sarah');
});

test.each(['order', 'cast'] as const)('%s edits invalidate an uncertain attempt', async change => {
    mockRequest.mockRejectedValue(new ApiError(0, 'network'));
    await render(); await fill(); await click(generate());
    if (change === 'order') await click(button(t('dialogue.moveDown', { number: 1 })));
    else await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'George' })));
    await click(generate());
    const bodies = mockRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies[0].idempotency_key).not.toBe(bodies[1].idempotency_key);
});

const rename = async (value: string, number = 1) => {
    const input = root.container.queryAll(node => node.props.accessibilityLabel === t('dialogue.speaker', { number }) && typeof node.props.onChangeText === 'function')[0];
    await act(async () => input.props.onChangeText(value));
};
const turnVoice = (number: number, voice: string) => expect(textOf(root.container)).toContain(t('dialogue.turnVoice', { number, voice }));

test('R06: fresh studio hides only wordsRequired until a turn is edited', async () => {
    await render();
    expect(textOf(root.container)).not.toContain(t('dialogue.wordsRequired'));
    expect(generate().props.accessibilityState.disabled).toBe(true);
    await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'George' })));
    expect(textOf(root.container)).not.toContain(t('dialogue.wordsRequired'));
    await write('Hello');
    expect(textOf(root.container)).toContain(t('dialogue.wordsRequired'));
    expect(generate().props.accessibilityState.disabled).toBe(true);
    await write('Hi', 2); await rename('Ana', 2);
    expect(textOf(root.container)).toContain(t('dialogue.speakerLimit'));
});
test('R04: successive renames carry George without changing Ben or persisting partial names', async () => {
    mockLoadCast.mockResolvedValue([{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Aria' }, { speaker: 'Mia', voice: 'Sarah' }]);
    await render(); await fill();
    for (const name of ['An', 'Anna', '', 'Anna']) {
        await rename(name); turnVoice(2, 'Aria');
        if (name) turnVoice(1, 'George');
    }
    for (let i = 0; i < 30; i++) await rename(`Anna${i}`);
    turnVoice(1, 'George'); turnVoice(2, 'Aria');
    await rename('Mia'); turnVoice(1, 'George'); // Rename wins over Mia's saved preference.
    await click(button(t('dialogue.add'))); await rename('Mia', 3); await rename('Guest', 3);
    // Splitting a name allocates a free voice; the original speaker stays on George.
    turnVoice(1, 'George'); turnVoice(2, 'Aria'); turnVoice(3, 'Roger');
    expect(mockSaveCast).not.toHaveBeenCalled(); expect(mockForgetCast).not.toHaveBeenCalled();
    await click(button(t('dialogue.remove', { number: 3 })));
    await click(button(t('dialogue.moveDown', { number: 1 })));
    turnVoice(1, 'Aria'); turnVoice(2, 'George');
});
test('R04: renaming to an existing speaker adopts that voice and keeps the other turns stable', async () => {
    mockLoadCast.mockResolvedValue([{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Aria' }]);
    await render(); await fill(); await rename('ben');
    turnVoice(1, 'Aria'); turnVoice(2, 'Aria');
    expect(mockSaveCast).not.toHaveBeenCalled();
});
test.each(['saved-job', 'unavailable-job'])('R02: only explicit changes persist after %s', async id => {
    const cache = createCache(createMemoryStorage());
    const unrelated = [{ speaker: 'Mia', voice: 'Sarah' }, { speaker: 'Tom', voice: 'George' }];
    await cache.write(POLICIES.dialogueCast, unrelated, mockOwner);
    const store = jest.requireActual<typeof import('../src/lib/speech/dialogueCastStore')>('../src/lib/speech/dialogueCastStore');
    mockSaveCast.mockImplementation(value => store.saveDialogueCast(value, cache));
    mockReopen = id;
    if (id === 'saved-job') mockSavedList.mockResolvedValue([{ id, request: buildDialogueRequest(
        [{ speaker: 'Zoe', text: 'One' }, { speaker: 'Max', text: 'Two' }],
        [{ speaker: 'Zoe', voice: 'George' }, { speaker: 'Max', voice: 'Sarah' }], mockModel) }]);
    await render(); expect(mockSaveCast).not.toHaveBeenCalled();
    const speaker = id === 'saved-job' ? 'Zoe' : 'Ana';
    await click(button(t('dialogue.chooseVoice', { speaker, voice: 'Roger' })));
    expect(mockSaveCast).toHaveBeenLastCalledWith(id === 'saved-job'
        ? [{ speaker: 'Zoe', voice: 'Roger' }]
        : [{ speaker: 'Ana', voice: 'Roger' }]);
    await mockSaveCast.mock.results[0].value;
    expect((await cache.read(POLICIES.dialogueCast, mockOwner))?.value).toEqual(expect.arrayContaining(unrelated));
});
test('R03: Reset forgets only current speakers and leaves unrelated preferences available', async () => {
    const cache = createCache(createMemoryStorage());
    const unrelated = [{ speaker: 'Mia', voice: 'Sarah' }, { speaker: 'Tom', voice: 'George' }];
    await cache.write(POLICIES.dialogueCast, [{ speaker: 'ANA', voice: 'George' }, { speaker: 'ben', voice: 'Aria' }, ...unrelated], mockOwner);
    const store = jest.requireActual<typeof import('../src/lib/speech/dialogueCastStore')>('../src/lib/speech/dialogueCastStore');
    mockForgetCast.mockImplementation(names => store.forgetDialogueCastSpeakers(names, cache));
    mockLoadCast.mockResolvedValue([{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Aria' }, { speaker: 'Mia', voice: 'Sarah' }, { speaker: 'Tom', voice: 'George' }]);
    await render(); await click(button(t('dialogue.resetCast')));
    expect(mockForgetCast).toHaveBeenCalledWith(['Ana', 'Ben']);
    await mockForgetCast.mock.results[0].value;
    expect((await cache.read(POLICIES.dialogueCast, mockOwner))?.value).toEqual(unrelated);
    expect(mockSaveCast).not.toHaveBeenCalled(); turnVoice(1, 'Aria'); turnVoice(2, 'Roger');
    await click(button(t('dialogue.add'))); await rename('Mia', 3);
    turnVoice(3, 'Sarah');
});

test('failed restore loads saved cast, and the note dismisses on edit before a new result', async () => {
    mockReopen = 'missing-job';
    mockLoadCast.mockResolvedValue([{ speaker: 'Ana', voice: 'Sarah' }, { speaker: 'Ben', voice: 'George' }]);
    await render(); turnVoice(1, 'Sarah'); turnVoice(2, 'George');
    expect(textOf(root.container)).toContain(t('dialogue.restoreUnavailable'));
    await write('Hello'); expect(textOf(root.container)).not.toContain(t('dialogue.restoreUnavailable'));
    await write('Hi', 2); await click(generate());
    expect(textOf(root.container)).not.toContain(t('dialogue.restoreUnavailable'));
});
test.each([false, true])('reopen retains per-job voices and uses preferences for added speakers, late load=%s', async late => {
    let release!: (value: unknown) => void;
    const saved = [{ speaker: 'Zoe', voice: 'Roger' }, { speaker: 'Mia', voice: 'Sarah' }];
    if (late) mockLoadCast.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    else mockLoadCast.mockResolvedValue(saved);
    mockReopen = 'saved-job'; mockSavedList.mockResolvedValue([{ id: mockReopen, request: buildDialogueRequest(
        [{ speaker: 'Zoe', text: 'One' }, { speaker: 'Max', text: 'Two' }],
        [{ speaker: 'Zoe', voice: 'George' }, { speaker: 'Max', voice: 'Aria' }], mockModel) }]);
    await render(); turnVoice(1, 'George'); turnVoice(2, 'Aria');
    if (late) { await write('Edited before load'); await act(async () => release(saved)); }
    turnVoice(1, 'George'); turnVoice(2, 'Aria');
    await click(button(t('dialogue.add'))); await rename('Mia', 3); turnVoice(3, 'Sarah');
    expect(mockSaveCast).not.toHaveBeenCalled();
});
test('late preferences survive an earlier default-derived swap and remain usable', async () => {
    let release!: (value: unknown) => void;
    mockLoadCast.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await render(); await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'Roger' })));
    expect(mockSaveCast).toHaveBeenLastCalledWith([{ speaker: 'Ana', voice: 'Roger' }]);
    await act(async () => release([{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Sarah' }]));
    turnVoice(1, 'Roger'); turnVoice(2, 'Aria');
    await rename('Guest', 2); await click(button(t('dialogue.add'))); await rename('Ben', 3);
    turnVoice(3, 'Sarah');
});
test('swapping restored voices writes only the chosen speaker and keeps the other saved preference', async () => {
    const saved = [{ speaker: 'Ana', voice: 'Sarah' }, { speaker: 'Ben', voice: 'George' }];
    const cache = createCache(createMemoryStorage());
    await cache.write(POLICIES.dialogueCast, saved, mockOwner);
    const store = jest.requireActual<typeof import('../src/lib/speech/dialogueCastStore')>('../src/lib/speech/dialogueCastStore');
    mockLoadCast.mockResolvedValue(saved); mockSaveCast.mockImplementation(value => store.saveDialogueCast(value, cache));
    mockReopen = 'saved-job'; mockSavedList.mockResolvedValue([{ id: mockReopen, request: buildDialogueRequest(
        [{ speaker: 'Ana', text: 'One' }, { speaker: 'Ben', text: 'Two' }],
        [{ speaker: 'Ana', voice: 'Roger' }, { speaker: 'Ben', voice: 'Sarah' }], mockModel) }]);
    await render(); await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'Sarah' })));
    turnVoice(1, 'Sarah'); turnVoice(2, 'Roger');
    expect(mockSaveCast).toHaveBeenLastCalledWith([{ speaker: 'Ana', voice: 'Sarah' }]);
    await mockSaveCast.mock.results[0].value;
    expect((await cache.read(POLICIES.dialogueCast, mockOwner))?.value).toEqual(saved);
    await rename('Guest', 2); await click(button(t('dialogue.add'))); await rename('Ben', 3);
    turnVoice(3, 'George');
});
test.each(['saved', 'explicit'])('choosing a %s voice from a default speaker never overwrites the other speaker', async origin => {
    if (origin === 'saved') mockLoadCast.mockResolvedValue([{ speaker: 'Ben', voice: 'George' }]);
    await render();
    if (origin === 'explicit') await click(button(t('dialogue.chooseVoice', { speaker: 'Ben', voice: 'George' })));
    await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'George' })));
    expect(mockSaveCast).toHaveBeenLastCalledWith([{ speaker: 'Ana', voice: 'George' }]);
});
test('swapping two saved voices persists both speakers', async () => {
    mockLoadCast.mockResolvedValue([{ speaker: 'Ana', voice: 'Sarah' }, { speaker: 'Ben', voice: 'George' }]);
    await render(); await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'George' })));
    expect(mockSaveCast).toHaveBeenLastCalledWith([{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Sarah' }]);
});
test('a default voice handed over in a swap cannot be saved by a later swap', async () => {
    mockLoadCast.mockResolvedValue([{ speaker: 'Ben', voice: 'George' }]);
    await render(); await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'George' })));
    await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'Aria' })));
    expect(mockSaveCast).toHaveBeenLastCalledWith([{ speaker: 'Ana', voice: 'Aria' }]);
});
test('a speaker handed back their saved voice can take part in a full swap', async () => {
    mockLoadCast.mockResolvedValue([{ speaker: 'Ben', voice: 'George' }]);
    await render(); await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'George' })));
    await click(button(t('dialogue.chooseVoice', { speaker: 'Ana', voice: 'Aria' })));
    await click(button(t('dialogue.chooseVoice', { speaker: 'Ben', voice: 'Aria' })));
    expect(mockSaveCast).toHaveBeenLastCalledWith([{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Aria' }]);
});
test('choosing a saved voice for a renamed speaker never saves the carried voice on the other speaker', async () => {
    mockLoadCast.mockResolvedValue([{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Aria' }]);
    await render(); await fill(); await rename('Zoe');
    await click(button(t('dialogue.chooseVoice', { speaker: 'Zoe', voice: 'Aria' })));
    expect(mockSaveCast).toHaveBeenLastCalledWith([{ speaker: 'Zoe', voice: 'Aria' }]);
});
test('rename carry survives a temporary merge and unrelated words edits while blank', async () => {
    mockLoadCast.mockResolvedValue([{ speaker: 'Sam', voice: 'Aria' }, { speaker: 'Ben', voice: 'George' }]);
    await render(); await rename('Sam'); await fill();
    for (const name of ['S', 'Sa', 'Sam', 'Sama', 'Saman', 'Samantha']) {
        await rename(name, 2); turnVoice(1, 'Aria'); turnVoice(2, name === 'Sam' ? 'Aria' : 'George');
    }
    await rename('', 2); await write('Changed words', 2); await rename('Bob', 2);
    turnVoice(1, 'Aria'); turnVoice(2, 'George'); expect(mockSaveCast).not.toHaveBeenCalled();
});
test('routine character count is quiet while validation stays live', async () => {
    await render(); await write('Hello');
    const count = plural('dialogue.characters', 'Ana: Hello\nBen: '.length, { max: 1000 });
    const counters = root.container.queryAll(node => textOf(node) === count);
    expect(counters.length).toBeGreaterThan(0);
    expect(counters.every(node => node.props.accessibilityLiveRegion === undefined)).toBe(true);
    expect(root.container.queryAll(node => textOf(node) === t('dialogue.wordsRequired') && node.props.accessibilityLiveRegion === 'polite').length).toBeGreaterThan(0);
});

test.each(['Zoe', 'Zo'])('a voice carried by a rename to %s is never saved for that name on a swap', async name => {
    mockLoadCast.mockResolvedValue([{ speaker: 'Ana', voice: 'George' }, { speaker: 'Ben', voice: 'Aria' }, { speaker: 'Zoe', voice: 'Sarah' }]);
    await render(); await fill();
    await rename(name); turnVoice(1, 'George');
    await click(button(t('dialogue.chooseVoice', { speaker: 'Ben', voice: 'George' })));
    expect(mockSaveCast).toHaveBeenCalledTimes(1);
    expect(mockSaveCast.mock.calls[0][0]).toEqual([{ speaker: 'Ben', voice: 'George' }]);
});
test('Make another on a job accepted after leaving the screen creates a new take with a new key', async () => {
    let release!: (value: unknown) => void;
    mockRequest.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await render(); await fill(); await click(generate());
    await act(async () => root.unmount()); root = createRoot();
    await act(async () => { release({ job_id: 'detached-job' }); await new Promise(resolve => setTimeout(resolve, 0)); });
    const turns = [{ speaker: 'Ana', text: 'Hello' }, { speaker: 'Ben', text: 'Hi' }];
    const cast = [{ speaker: 'Ana', voice: 'Aria' }, { speaker: 'Ben', voice: 'Roger' }];
    mockReopen = 'detached-job'; mockSavedList.mockResolvedValue([{ id: mockReopen, request: buildDialogueRequest(turns, cast, mockModel) }]);
    await render(); expect(mockRequest).toHaveBeenCalledTimes(1);
    await click(generate());
    expect(mockRequest).toHaveBeenCalledTimes(2);
    const bodies = mockRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies[1].inputs).toEqual(bodies[0].inputs);
    expect(bodies[1].idempotency_key).not.toBe(bodies[0].idempotency_key);
});

