import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import Speech from '../src/app/(app)/speech';
import { ModelUnavailable } from '../src/components/create/ModelUnavailable';
import { SpeechPricePanel } from '../src/components/speech/SpeechPricePanel';
import { TTS_VOICES, TTS_SCRIPT_LIMIT } from '../src/lib/speech/shared';
import { ApiError } from '../src/lib/api';
import type { CatalogModel } from '../src/lib/media';
import type { JobResult } from '../src/lib/createResult';
import { plural, t, setLocaleFromDevice } from '../src/lib/i18n';
import { rawText } from '../src/lib/i18n/translate';
import { OfflineError } from '../src/lib/network';
const mockRouter = { push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), back: jest.fn() };
const mockTitles: string[] = [];
let mockReopen: string | undefined;
const mockSavedList = jest.fn();
const mockLoadCatalog = jest.fn();
const mockRequest = jest.fn(), mockRemember = jest.fn(), mockRefresh = jest.fn();
const mockApi = { request: mockRequest, getBalance: jest.fn(), stream: jest.fn() };
const mockModel: CatalogModel = { id: 'minimax-speech-2.6-hd', name: 'Speech', modality: 'text-to-speech', credits: 6, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
let mockCatalog: CatalogModel[], mockBalance: number | null, mockResult: JobResult, mockOwner: string;
const mockSubscribers = new Set<() => void>();
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ reopen: mockReopen }), Stack: { Screen: ({ options }: { options: { title: string } }) => { mockTitles.push(options.title); return null; } }, useRouter: () => mockRouter }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockSubscribers.add(fn); return () => mockSubscribers.delete(fn); } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: () => mockLoadCatalog() }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => mockBalance }));
jest.mock('../src/lib/createResult', () => ({ useJobResult: () => mockResult, soundPassFor: () => null, refreshBalance: (...args: unknown[]) => mockRefresh(...args) }));
jest.mock('../src/lib/submittedRequests', () => ({ rememberSubmitted: (...args: unknown[]) => mockRemember(...args),
    submittedRequests: { list: async () => [...((await mockSavedList()) ?? []), ...mockRemember.mock.calls.map(([id]) => ({ id }))] } }));
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
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: (props: object) => jest.requireActual('react').createElement(jest.requireActual('react-native').View, { ...props, testID: 'speech-player' }) }));
jest.mock('../src/components/library/GeneratedChip', () => ({ GeneratedChip: () => null }));
jest.mock('../src/components/KeyboardScreen', () => ({ KeyboardScreen: jest.requireActual('react-native').View }));
jest.mock('../src/components/KeyboardFormScrollView', () => ({ KeyboardFormScrollView: jest.requireActual('react-native').View }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: jest.fn(() => ['screen', 'attempt', ++n].join('-')) }; });
void [RN.View, RN.Text, RN.TextInput, RN.StyleSheet, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
let root: Root;
const textOf = (node: TestInstance): string => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const button = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === rawText(label) && typeof node.props.onClick === 'function')[0];
const generate = () => button(plural('speech.generate', 6));
const click = async (node: TestInstance) => { await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); };
const render = async () => { await act(async () => root.render(<Speech />)); };
const write = async (value: string) => {
    const input = root.container.queryAll(node => node.props.accessibilityLabel === t('speech.script') && typeof node.props.onChangeText === 'function')[0];
    await act(async () => input.props.onChangeText(value));
};
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    setLocaleFromDevice(['en']); mockTitles.length = 0; mockLoadCatalog.mockReset().mockImplementation(async () => mockCatalog);
    mockRouter.replace.mockClear(); mockRouter.back.mockClear(); mockRouter.canGoBack.mockReturnValue(false);
    mockOwner = 'a'; mockSubscribers.forEach(fn => fn()); mockReopen = undefined; mockSavedList.mockReset().mockResolvedValue([]); mockCatalog = [mockModel]; mockBalance = 10;
    mockResult = { state: 'queued' }; mockRequest.mockReset().mockResolvedValue({ job_id: 'speech-job' });
    mockRemember.mockReset().mockResolvedValue(undefined); mockRefresh.mockReset(); mockRouter.push.mockClear();
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });
test('catalog price and balance are visible; shortfall blocks Generate and opens credits', async () => {
    mockBalance = 2; await render(); await write('Hello');
    expect(textOf(root.container)).toContain(plural('speech.price', 6));
    expect(textOf(root.container)).toContain(plural('speech.balance', 2));
    expect(textOf(root.container)).toContain(plural('speech.shortfall', 4));
    expect(generate().props.accessibilityState.disabled).toBe(true);
    await click(generate()); expect(mockRequest).not.toHaveBeenCalled();
    await click(button(t('speech.addCredits'))); expect(mockRouter.push).toHaveBeenCalledWith('/credits');
});
test.each([{ rows: [] }, { rows: [{ ...mockModel, gated: true }] }])('missing or gated model cannot submit', async ({ rows }) => {
    mockCatalog = rows; await render();
    expect(textOf(root.container)).toContain(t('form.modelGone'));
    expect(generate()).toBeUndefined();
    expect(mockTitles.at(-1)).toBe(t('speech.title'));
    await click(button(t('speech.back')));
    expect(mockRouter.replace).toHaveBeenCalledWith('/audio');
});
test('empty/oversize text blocks; an oversized cue leaves the script unchanged and announces the limit', async () => {
    await render(); expect(generate().props.accessibilityState.disabled).toBe(true);
    await write('x'.repeat(501)); expect(generate().props.accessibilityState.disabled).toBe(true);
    await write('x'.repeat(498)); await click(button(t('speech.pauseSeconds', { seconds: 1 })));
    expect(textOf(root.container)).toContain(t('speech.tooLong'));
    const input = root.container.queryAll(node => node.props.onChangeText && node.props.value === 'x'.repeat(498));
    expect(input.length).toBeGreaterThan(0);
});
test('accepted speech renders the shared result/player, records history and refreshes balance; adjust resets', async () => {
    mockResult = { state: 'succeeded', job: { state: 'succeeded', credits: 6, model_id: mockModel.id }, asset: { url: 'https://speech.invalid/mock.mp3', mime_type: 'audio/mpeg' } };
    await render(); await write('Hello'); await click(generate());
    const player = root.container.queryAll(node => node.props.testID === 'speech-player')[0];
    expect(player.props.audio).toBe(true); expect(player.props.url).toContain('mock.mp3');
    expect(mockRemember).toHaveBeenCalledWith('speech-job', expect.objectContaining({ prompt: 'Hello', analyticsKind: 'audio' }), expect.anything(), expect.anything());
    expect(mockRefresh).toHaveBeenCalled();
    await click(button(t('speech.adjust'))); expect(generate()).toBeDefined();
    expect(generate().props.accessibilityState.disabled).toBe(false);
});
test('shared failed result shows refunded credits', async () => {
    mockResult = { state: 'failed', job: { state: 'failed', credits: 6, model_id: mockModel.id, refunded: true } };
    await render(); await write('Hello'); await click(generate());
    expect(textOf(root.container)).toMatch(/refund/i);
    expect(textOf(root.container)).toContain('6');
});
test('after a lost reply, a retry, a trailing space and an edit away and back all keep the key', async () => {
    mockRequest.mockRejectedValue(new ApiError(0, 'network'));
    await render(); await write('Hello'); await click(generate()); await click(generate());
    await write('Hello '); await click(generate());
    await write('Changed'); await write('Hello'); await click(generate());
    const bodies = mockRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(4);
    expect(new Set(bodies.map(body => body.idempotency_key)).size).toBe(1);
});
test('after a lost reply, a really different script gets a new key', async () => {
    mockRequest.mockRejectedValue(new ApiError(0, 'network'));
    await render(); await write('Hello'); await click(generate());
    await write('Changed'); await click(generate());
    const bodies = mockRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(2);
    expect(bodies[1].idempotency_key).not.toBe(bodies[0].idempotency_key);
});
test('after a lost reply, the retry stays possible at zero balance once the edit is undone', async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(0, 'network'));
    await render(); await write('Hello'); await click(generate());
    mockBalance = 0; await write('Changed'); await write('Hello');
    expect(generate().props.accessibilityState.disabled).toBe(false);
    await click(generate());
    const bodies = mockRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(2);
    expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key);
});
test.each([new OfflineError(), new ApiError(400, 'consent_declined'), new ApiError(402, 'subscription_required')])('submission errors remain visible and retryable: %p', async error => {
    mockRequest.mockRejectedValueOnce(error);
    await render(); await write('Hello'); await click(generate());
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
    expect(generate().props.accessibilityState.disabled).toBe(false);
});
test('account changes clear script and result', async () => {
    await render(); await write('Private script');
    await act(async () => { mockOwner = 'b'; mockSubscribers.forEach(fn => fn()); });
    expect(generate().props.accessibilityState.disabled).toBe(true);
    expect(root.container.queryAll(node => node.props.value === 'Private script')).toHaveLength(0);
});

test('loading and load failure retain the speech title; recovery uses history when available', async () => {
    mockLoadCatalog.mockImplementationOnce(() => new Promise(() => {}));
    await render();
    expect(mockTitles.at(-1)).toBe(t('speech.title'));
    expect(generate()).toBeUndefined();
    await act(async () => root.unmount()); root = createRoot();
    mockLoadCatalog.mockRejectedValueOnce(new Error('catalog unavailable'));
    mockRouter.canGoBack.mockReturnValue(true);
    await render();
    expect(mockTitles.at(-1)).toBe(t('speech.title'));
    await click(button(t('speech.back')));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
});
test('generic unavailable callers retain their Create title and recovery choices', async () => {
    await act(async () => root.render(<ModelUnavailable error={t('form.modelGone')} fromTemplate={false} />));
    expect(mockTitles.at(-1)).toBe(t('label.Create'));
    await click(button(t('form.modelGoneChoose')));
    expect(mockRouter.replace).toHaveBeenCalledWith('/create');
    expect(button(t('form.modelBack'))).toBeDefined();
});
test('native input limit and counter include whitespace; validation remains a backstop', async () => {
    await render();
    const input = root.container.queryAll(node => node.props.onChangeText && node.props.accessibilityLabel === t('speech.script'))[0];
    expect(input.props.maxLength).toBe(TTS_SCRIPT_LIMIT);
    await write(' ' + 'x'.repeat(499));
    expect(textOf(root.container)).toContain(t('speech.counter', { count: 500, max: 500 }));
    expect(generate().props.accessibilityState.disabled).toBe(false);
    // A synthetic input callback bypasses the native length cap and verifies the backstop.
    await write(' ' + 'x'.repeat(500));
    expect(generate().props.accessibilityState.disabled).toBe(true);
});
test('voice tones are translated in the selected button, rows and accessibility labels', async () => {
    setLocaleFromDevice(['es']); await render();
    const voice = TTS_VOICES[0];
    const tone = t(`speech.tone.${voice.tone}`), gender = t(`speech.gender.${voice.gender}`);
    expect(tone).not.toBe(voice.tone);
    await click(button(`${voice.label} · ${tone} · ${gender}`));
    expect(textOf(root.container)).toContain(`${tone} · ${gender}`);
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel === `${voice.label}, ${tone}, ${gender}`).length).toBeGreaterThan(0);
});
test.each([1, 2])('price panel uses credit plurals for %s', async count => {
    await act(async () => root.render(<SpeechPricePanel price={count} payable={count * 2} balance={count} disabled={false} busy={false} onGenerate={() => {}} onCredits={() => {}} />));
    for (const family of ['speech.price', 'speech.balance', 'speech.shortfall', 'speech.generate']) expect(textOf(root.container)).toContain(plural(family, count));
    expect(textOf(root.container)).toContain(count === 1 ? '1 credit' : '2 credits');
});
test('unknown balance is not formatted as a numeric plural', async () => {
    mockBalance = null; await render();
    expect(textOf(root.container)).toContain(t('speech.balanceUnknown'));
});


test('Make another restores all six speech controls as one voice with an empty audition board', async () => {
    mockReopen = 'audition-job';
    const inputs = { tts_voice: 'Wise_Woman', tts_language: 'English', tts_emotion: 'happy', tts_speed: 1.2, tts_volume: 2, tts_pitch: 3 };
    mockSavedList.mockResolvedValue([{ id: mockReopen, request: { modelId: mockModel.id, prompt: 'Remembered words', extraInputs: inputs } }]);
    await render(); expect(mockRequest).not.toHaveBeenCalled();
    expect(generate()).toBeDefined(); await click(generate());
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockRequest.mock.calls[0][1].body).inputs).toEqual({ prompt: 'Remembered words', ...inputs });
});
test('corrupt speech restore opens empty with a translated note', async () => {
    mockReopen = 'broken-job'; mockSavedList.mockResolvedValue([{ id: mockReopen, request: { modelId: mockModel.id, prompt: 'Secret', extraInputs: { tts_voice: 'invalid' } } }]);
    await render(); expect(textOf(root.container)).toContain(t('dialogue.restoreUnavailable'));
    expect(generate().props.accessibilityState.disabled).toBe(true); expect(mockRequest).not.toHaveBeenCalled();
    await write('New script'); expect(textOf(root.container)).not.toContain(t('dialogue.restoreUnavailable'));
    await click(generate()); expect(textOf(root.container)).not.toContain(t('dialogue.restoreUnavailable'));
});
test('leaving and reopening preserves an unknown key; no-op edits preserve its warning', async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(0, 'network'));
    await render(); await write('Hello'); await click(generate());
    await write('Hello ');
    expect(textOf(root.container)).toContain(t('form.err.network'));
    await act(async () => root.unmount()); root = createRoot();
    await render(); await write('Hello'); await click(generate());
    const bodies = mockRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key);
});

test('Adjust after a completed take permits a new take with a fresh key', async () => {
    await render(); await write('Hello'); await click(generate());
    await click(button(t('speech.adjust'))); await click(generate());
    const bodies = mockRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(2);
    expect(bodies[1].idempotency_key).not.toBe(bodies[0].idempotency_key);
});
