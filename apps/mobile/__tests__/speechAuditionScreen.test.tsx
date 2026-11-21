import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import Speech from '../src/app/(app)/speech';
import { TTS_VOICES, voiceAuditionScript } from '../src/lib/speech/shared';
import { ApiError } from '../src/lib/api';
import type { CatalogModel } from '../src/lib/media';
import type { JobResult } from '../src/lib/createResult';
import { plural, t, setLocaleFromDevice } from '../src/lib/i18n';
import { rawText } from '../src/lib/i18n/translate';
import { auditionBatchNote } from '../src/lib/speech/audition';
const mockRouter = { push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), back: jest.fn() };
const mockTitles: string[] = [];
const mockLoadCatalog = jest.fn();
const mockRequest = jest.fn(), mockRemember = jest.fn(), mockRefresh = jest.fn();
const mockApi = { request: mockRequest, getBalance: jest.fn(), stream: jest.fn() };
const mockModel: CatalogModel = { id: 'minimax-speech-2.6-hd', name: 'Speech', modality: 'text-to-speech', credits: 6, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
let mockCatalog: CatalogModel[], mockBalance: number | null, mockResult: JobResult, mockOwner: string;
const mockSubscribers = new Set<() => void>();
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), Stack: { Screen: ({ options }: { options: { title: string } }) => { mockTitles.push(options.title); return null; } }, useRouter: () => mockRouter, useFocusEffect: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockSubscribers.add(fn); return () => mockSubscribers.delete(fn); } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: () => mockLoadCatalog() }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => mockBalance }));
jest.mock('../src/lib/createResult', () => ({ useJobResult: () => mockResult, soundPassFor: () => null, refreshBalance: (...args: unknown[]) => mockRefresh(...args) }));
jest.mock('../src/lib/submittedRequests', () => ({ rememberSubmitted: (...args: unknown[]) => mockRemember(...args) }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => {}, hasAgreed: async () => true } }));
jest.mock('../src/lib/celebrate', () => ({ noteLocalSubmission: jest.fn(), celebrateOutput: jest.fn() }));
jest.mock('../src/lib/milestoneHistory', () => ({ settleFirstMilestones: async () => {} }));
jest.mock('../src/lib/analytics/generations', () => ({ noteGenerationSubmitted: jest.fn() }));
jest.mock('../src/lib/generationProgress', () => ({ noteJobStarted: jest.fn() }));
jest.mock('../src/components/GenerationProgress', () => ({ GenerationProgress: () => null }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/components/library/GeneratedChip', () => ({ GeneratedChip: () => null }));
jest.mock('../src/components/KeyboardScreen', () => ({ KeyboardScreen: jest.requireActual('react-native').View }));
jest.mock('../src/components/KeyboardFormScrollView', () => ({ KeyboardFormScrollView: jest.requireActual('react-native').View }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: jest.fn(() => ['screen', 'attempt', ++n].join('-')) }; });
void [RN.View, RN.Text, RN.TextInput, RN.StyleSheet, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
let root: Root;
const textOf = (node: TestInstance): string => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const button = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === rawText(label) && typeof node.props.onClick === 'function')[0];
const generate = (count = 0) => button(count === 1 ? t('speech.audition.addOne') : count ? plural('speech.audition.generate', count) : plural('speech.generate', 6));
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
    mockPlayers.length = 0; mockOwner = 'a'; mockCatalog = [mockModel]; mockBalance = 10;
    mockResult = { state: 'queued' }; let nextJob = 0; mockRequest.mockReset().mockImplementation(async () => ({ job_id: `speech-job-${++nextJob}` }));
    mockRemember.mockReset().mockResolvedValue(undefined); mockRefresh.mockReset(); mockRouter.push.mockClear();
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); setLocaleFromDevice(['en']); });
// Real InlineMedia and AudioSeekBar, with only the native player/decorative canvas replaced.
const mockPlayers: { play: jest.Mock; pause: jest.Mock; currentTime: number; listeners: Record<string, (event: any) => void> }[] = [];
jest.mock('../src/components/CassetteReels', () => ({ CassetteReels: () => null }));
jest.mock('expo-video', () => ({
    VideoView: jest.requireActual('react-native').View,
    useVideoPlayer: () => jest.requireActual('react').useMemo(() => {
        const listeners: Record<string, (event: any) => void> = {};
        const player = { duration: 20, currentTime: 0, status: 'readyToPlay', muted: true, play: jest.fn(), pause: jest.fn(), listeners,
            addListener: (event: string, callback: (value: any) => void) => { listeners[event] = callback; return { remove: jest.fn() }; } };
        mockPlayers.push(player); return player;
    }, []),
}));
const selectedVoice = (index = 0) => {
    const voice = TTS_VOICES[index];
    return button(`${voice.label} · ${t(`speech.tone.${voice.tone}`)} · ${t(`speech.gender.${voice.gender}`)}`);
};
const add = async (index: number) => click(button(t('speech.audition.add', { voice: TTS_VOICES[index].label })));
const setupBoard = async (count: number) => {
    await render(); await write('Hello'); await click(selectedVoice());
    for (let i = 0; i < count; i++) await add(i);
};
const bodies = () => mockRequest.mock.calls.map(([, init]) => JSON.parse(init.body));
test('Test selects its row, loads the shared script, closes the picker and spends/plays nothing; Generate uses that voice', async () => {
    await render(); await click(selectedVoice());
    await click(button(t('speech.audition.testVoice', { voice: TTS_VOICES[2].label })));
    expect(mockRequest).not.toHaveBeenCalled(); expect(mockPlayers).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.value === voiceAuditionScript()).length).toBeGreaterThan(0);
    expect(button(t('speech.audition.testVoice', { voice: TTS_VOICES[2].label }))).toBeUndefined();
    expect(selectedVoice(2)).toBeDefined();
    await click(generate());
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].inputs).toMatchObject({ prompt: voiceAuditionScript().trim(), tts_voice: TTS_VOICES[2].id });
});
test('one voice blocks Generate, two enable it; three disable additions but allow removal and clearing', async () => {
    mockBalance = 30; await setupBoard(1);
    expect(textOf(root.container)).toContain(t('speech.audition.invalidVoices'));
    expect(generate(1).props.accessibilityState.disabled).toBe(true);
    await click(generate(1)); expect(mockRequest).not.toHaveBeenCalled();
    await add(1); expect(generate(2).props.accessibilityState.disabled).toBe(false);
    expect(textOf(root.container)).toContain(plural('speech.audition.price', 2, { unit: 6, total: 12 }));
    await add(2);
    expect(textOf(root.container)).toContain(t('speech.audition.count', { count: 3, max: 3 }));
    const fourth = button(t('speech.audition.add', { voice: TTS_VOICES[3].label }));
    expect(fourth.props.accessibilityState.disabled).toBe(true); await click(fourth);
    expect(generate(3)).toBeDefined();
    const remove = button(t('speech.audition.remove', { voice: TTS_VOICES[1].label }));
    expect(remove.props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    await click(remove); expect(generate(2)).toBeDefined();
    await click(button(t('speech.audition.clear'))); expect(generate()).toBeDefined();
    expect(textOf(root.container)).toContain(t('speech.audition.count', { count: 0, max: 3 }));
});
test.each(['row', 'Test'])('changing only the single voice via %s preserves accepted and unknown board jobs', async action => {
    mockBalance = 12;
    mockRequest.mockResolvedValueOnce({ job_id: 'one' })
        .mockImplementationOnce(async () => { mockBalance = 0; throw new ApiError(0, 'network'); })
        .mockResolvedValueOnce({ job_id: 'two' });
    await setupBoard(2);
    // Test loads this same script, so neither action changes submitted batch content.
    await write(voiceAuditionScript()); await click(generate(2));
    expect(bodies()).toHaveLength(2);
    const voice = TTS_VOICES[2];
    await click(button(action === 'Test' ? t('speech.audition.testVoice', { voice: voice.label })
        : `${voice.label}, ${t(`speech.tone.${voice.tone}`)}, ${t(`speech.gender.${voice.gender}`)}`));
    expect(selectedVoice(2)).toBeDefined();
    expect(generate(2).props.accessibilityState.disabled).toBe(false);
    await click(generate(2));
    expect(bodies().map(body => body.inputs.tts_voice)).toEqual([TTS_VOICES[0].id, TTS_VOICES[1].id, TTS_VOICES[1].id]);
    expect(bodies()[2]).toEqual(bodies()[1]);
    expect(mockRemember.mock.calls.map(([id]) => id)).toEqual(['one', 'two']);
});
test('batch shortfall blocks all submissions', async () => {
    mockBalance = 10; await setupBoard(2);
    expect(textOf(root.container)).toContain(plural('speech.shortfall', 2));
    expect(generate(2).props.accessibilityState.disabled).toBe(true);
    await click(generate(2)); expect(mockRequest).not.toHaveBeenCalled();
});
test('lost item 2 reply after 12 credits: zero-balance retry retains its key and original price, with remaining maximum separate', async () => {
    mockBalance = 12;
    mockRequest.mockResolvedValueOnce({ job_id: 'one' }).mockImplementationOnce(async () => { mockBalance = 0; throw new ApiError(0, 'network'); }).mockResolvedValueOnce({ job_id: 'two' });
    await setupBoard(2); await click(generate(2));
    expect(textOf(root.container)).toContain(auditionBatchNote(1, TTS_VOICES.slice(0, 2).map(voice => voice.id), true));
    expect(textOf(root.container)).toContain(plural('speech.audition.price', 2, { unit: 6, total: 12 }));
    expect(textOf(root.container)).toContain(plural('speech.audition.remaining', 6));
    expect(generate(2).props.accessibilityState.disabled).toBe(false);
    await click(generate(2));
    expect(bodies().map(body => body.inputs.tts_voice)).toEqual([TTS_VOICES[0].id, TTS_VOICES[1].id, TTS_VOICES[1].id]);
    expect(bodies()[2].idempotency_key).toBe(bodies()[1].idempotency_key);
    for (const voice of TTS_VOICES.slice(0, 2)) expect(textOf(root.container)).toContain(t('speech.audition.result', { voice: voice.label }));
    expect(button(t('speech.adjust'))).toBeDefined();
});
test.each(['settings', 'board'])('editing %s away and back after partial failure starts fresh keys', async field => {
    mockBalance = 30;
    mockRequest.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(new ApiError(0, 'network'));
    await setupBoard(2); await click(generate(2));
    if (field === 'settings') {
        await click(button(t('speech.increase', { label: t('speech.speed') })));
        await click(button(t('speech.decrease', { label: t('speech.speed') })));
    }
    if (field === 'board') {
        await click(button(t('speech.audition.remove', { voice: TTS_VOICES[1].label }))); await add(1);
    }
    await click(generate(2));
    expect(bodies()).toHaveLength(4);
    const oldKeys = bodies().slice(0, 2).map(body => body.idempotency_key);
    for (const body of bodies().slice(2)) expect(oldKeys).not.toContain(body.idempotency_key);
});
test('script edit and revert after a lost batch reply retains the pending key and accepted item', async () => {
    mockBalance = 12;
    mockRequest.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValueOnce({ job_id: 'two' });
    await setupBoard(2); await click(generate(2));
    mockBalance = 0; await write('Changed'); await write('Hello');
    expect(generate(2).props.accessibilityState.disabled).toBe(false);
    await click(generate(2)); expect(bodies()).toHaveLength(3); expect(bodies()[2]).toEqual(bodies()[1]);
    expect(mockRemember.mock.calls.map(([id]) => id)).toEqual(['one', 'two']);
    for (const voice of TTS_VOICES.slice(0, 2)) expect(textOf(root.container)).toContain(t('speech.audition.result', { voice: voice.label }));
});
test('at phone width each voice has a single full-width audio result with its own play and seek controls', async () => {
    mockBalance = 18;
    mockRequest.mockResolvedValueOnce({ job_id: 'one' }).mockResolvedValueOnce({ job_id: 'two' }).mockResolvedValueOnce({ job_id: 'three' });
    mockResult = { state: 'succeeded', job: { state: 'succeeded', credits: 6, model_id: mockModel.id }, asset: { url: 'https://speech.invalid/mock.mp3', mime_type: 'audio/mpeg' } };
    await act(async () => root.render(<RN.View style={{ width: 320 }}><Speech /></RN.View>));
    await write('Hello'); await click(selectedVoice()); await add(0); await add(1); await add(2); await click(generate(3));
    const results = root.container.queryAll(node => String(node.props.testID ?? '').startsWith('speech-audition-result-'), { matchDeepestOnly: true });
    expect(results).toHaveLength(3);
    for (const result of results) {
        expect(RN.StyleSheet.flatten(result.props.style).width).toBe('100%');
        expect(result.queryAll(node => node.props.testID === 'inline-audio-toggle' && typeof node.props.onClick === 'function')).toHaveLength(1);
        expect(result.queryAll(node => node.props.testID === 'inline-audio-position' && typeof node.props.onClick === 'function')).toHaveLength(1);
        const constrained = result.queryAll(node => {
            if (!node.props.style || typeof node.props.style === 'function') return false;
            const style = RN.StyleSheet.flatten(node.props.style);
            return style?.width === '48%' || style?.aspectRatio === 1;
        });
        expect(constrained).toHaveLength(0);
    }
    for (const voice of TTS_VOICES.slice(0, 3)) expect(textOf(root.container)).toContain(t('speech.audition.result', { voice: voice.label }));
    // No actual media loads: exercise the real controls against isolated native-player doubles.
    const activePlayers = mockPlayers.slice(-3);
    expect(activePlayers.every(player => player.play.mock.calls.length === 0)).toBe(true);
    for (const player of activePlayers) await act(async () => player.listeners.sourceLoad({ duration: 20 }));
    const toggles = root.container.queryAll(node => node.props.testID === 'inline-audio-toggle' && typeof node.props.onClick === 'function');
    const seeks = root.container.queryAll(node => node.props.testID === 'inline-audio-position' && typeof node.props.onClick === 'function');
    for (let i = 0; i < 3; i++) {
        await click(toggles[i]); expect(activePlayers[i].play).toHaveBeenCalledTimes(1);
        await act(async () => seeks[i].props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
        expect(activePlayers[i].currentTime).toBe(10);
    }
});
test('a later preflight refusal does not misreport an earlier unknown item as definitely unstarted', async () => {
    mockBalance = 12;
    mockRequest.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(new ApiError(0, 'network')).mockRejectedValueOnce(new ApiError(402, 'subscription_required'));
    await setupBoard(2); await click(generate(2)); await click(generate(2));
    expect(textOf(root.container)).toContain(auditionBatchNote(1, TTS_VOICES.slice(0, 2).map(voice => voice.id), true));
    expect(bodies()[2].idempotency_key).toBe(bodies()[1].idempotency_key);
});
