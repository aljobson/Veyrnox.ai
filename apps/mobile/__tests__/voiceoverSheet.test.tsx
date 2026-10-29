import { act } from 'react';
import { AccessibilityInfo, Alert, AppState, Linking, Platform, StyleSheet } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { VoiceoverSheet } from '../src/components/editor/VoiceoverSheet';
import type { useVoiceoverRecorder } from '../src/components/editor/useVoiceoverRecorder';
import { t } from '../src/lib/i18n';

jest.setTimeout(15000);
let mockOwner: string | undefined = 'owner', mockReady = true, mockStartFrame = 0;
let mockHook: ReturnType<typeof useVoiceoverRecorder>, mockStatus: (status: any) => void;
let mockState = { isRecording: false, durationMillis: 0, metering: -60, mediaServicesDidReset: false };
const mockOwners = new Set<() => void>(), mockApps = new Set<(state: any) => void>();
const mockRecord = jest.fn(), mockStop = jest.fn(), mockPrepare = jest.fn(), mockMode = jest.fn(), mockGet = jest.fn(), mockRequest = jest.fn();
const mockRecorder = { record: mockRecord, stop: mockStop, prepareToRecordAsync: mockPrepare, uri: 'file://native.wav' };
const mockPlayer = { pause: jest.fn(), play: jest.fn(), seekTo: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })), playing: false, currentTime: 0, duration: 3 };
const mockAdopt = jest.fn(), mockDiscard = jest.fn(), mockRead = jest.fn(), mockHandleClose = jest.fn(), mockProbe = jest.fn();
const mockCopy = jest.fn(), mockInsert = jest.fn(), mockAdded = jest.fn(), mockClosed = jest.fn(), mockBegin = jest.fn(), mockEnd = jest.fn(), mockValid = jest.fn();
jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: true, VOICEOVER_OPTIONS: {}, useAudioRecorder: (_options: any, fn: any) => { mockStatus = fn; return mockRecorder; }, useAudioRecorderState: () => mockState, useAudioPlayer: () => mockPlayer, getRecordingPermissionsAsync: (...args: any[]) => mockGet(...args), requestRecordingPermissionsAsync: (...args: any[]) => mockRequest(...args), setAudioModeAsync: (...args: any[]) => mockMode(...args) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockOwners.add(fn); return () => mockOwners.delete(fn); } }));
jest.mock('../src/lib/editorVoiceoverTakes', () => ({ adoptTake: (...args: any[]) => mockAdopt(...args), discardTake: (...args: any[]) => mockDiscard(...args) }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: (...args: any[]) => mockProbe(...args) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' }, File: class { open() { return { readBytes: mockRead, close: mockHandleClose }; } } }));
jest.mock('../src/components/editor/useVoiceoverRecorder', () => ({ useVoiceoverRecorder: (props: any) => { mockHook = jest.requireActual('../src/components/editor/useVoiceoverRecorder').useVoiceoverRecorder(props); return mockHook; } }));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
let root: Root;
const wav = () => Uint8Array.from([... 'RIFF1234WAVE'].map(c => c.charCodeAt(0)));
async function render() { await act(async () => root.render(<VoiceoverSheet projectId="project" startFrame={mockStartFrame} fps={30} ready={mockReady} beginImport={mockBegin} preparePicked={mockCopy} insert={mockInsert} onAdded={mockAdded} onClose={mockClosed} />)); }
const button = (key: Parameters<typeof t>[0]) => root.container.queryAll(node => node.props.accessibilityLabel === t(key) && typeof node.props.onClick === 'function')[0];
async function press(key: Parameters<typeof t>[0]) { const node = button(key); expect(node).toBeDefined(); await act(async () => node.props.onClick({ nativeEvent: {} })); }
async function poll(patch: Partial<typeof mockState>) { mockState = { ...mockState, ...patch }; await render(); }
async function app(next: 'active' | 'background' | 'inactive') { await act(async () => { AppState.currentState = next; mockApps.forEach(fn => fn(next)); }); }
async function review() { await render(); await press('editorVoiceover.record'); await poll({ isRecording: true, durationMillis: 1000 }); await press('editorVoiceover.stop'); expect(mockHook.phase).toBe('review'); }
const enabledReview = () => { expect(mockHook.phase).toBe('review'); expect(mockHook.take).toBe('file://take.wav'); for (const key of ['add', 'close', 'rerecord', 'discard'] as const) expect(button(`editorVoiceover.${key}`).props.accessibilityState?.disabled).not.toBe(true); };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks();
    mockOwner = 'owner'; mockReady = true; mockStartFrame = 0; mockOwners.clear(); mockApps.clear();
    mockState = { isRecording: false, durationMillis: 0, metering: -60, mediaServicesDidReset: false }; mockRecorder.uri = 'file://native.wav';
    mockRecord.mockReset(); mockStop.mockReset().mockResolvedValue(undefined); mockPrepare.mockReset().mockResolvedValue(undefined); mockMode.mockReset().mockResolvedValue(undefined);
    mockGet.mockReset().mockResolvedValue({ granted: true, canAskAgain: true }); mockRequest.mockReset().mockResolvedValue({ granted: true });
    mockAdopt.mockReset().mockReturnValue('file://take.wav'); mockRead.mockReset().mockResolvedValue(wav()); mockProbe.mockReset().mockResolvedValue(3);
    mockCopy.mockReset().mockResolvedValue(3); mockInsert.mockReset().mockReturnValue('placed'); mockValid.mockReset().mockReturnValue(true);
    mockBegin.mockReset().mockImplementation(() => ({ valid: mockValid, end: mockEnd }));
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined); jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => { mockApps.add(fn); return { remove: () => { mockApps.delete(fn); } }; });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test('denial explains Settings without opening a link or asking when canAskAgain is false', async () => {
    mockGet.mockResolvedValue({ granted: false, canAskAgain: false }); await render(); await press('editorVoiceover.record');
    expect(mockHook.phase).toBe('denied'); expect(mockHook.message).toBe(t('editorVoiceover.denied')); expect(mockRequest).not.toHaveBeenCalled();
    expect(Linking.openSettings).not.toHaveBeenCalled(); expect(Linking.openURL).not.toHaveBeenCalled();
});
test('requests permission when allowed and refuses a playhead without a whole second', async () => {
    mockGet.mockResolvedValue({ granted: false, canAskAgain: true }); await render(); await press('editorVoiceover.record'); expect(mockRequest).toHaveBeenCalledTimes(1);
    await press('editorVoiceover.stop'); mockStartFrame = 17999; await render(); await press('editorVoiceover.rerecord'); expect(mockHook.message).toBe(t('editorVoiceover.noRoom')); expect(mockRecord).toHaveBeenCalledTimes(1);
});
test('shows elapsed time and a hidden meter; announces phases once, never ticks', async () => {
    await render(); await press('editorVoiceover.record'); await poll({ isRecording: true, durationMillis: 1000, metering: -30 });
    expect(root.container.queryAll(node => node.children.includes(t('editorVoiceover.recording', { time: '0:01', limit: '10:00' }))).length).toBeGreaterThan(0);
    const meter = root.container.queryAll(node => node.props.testID === 'voiceover-meter')[0];
    expect(meter.props.accessibilityElementsHidden).toBe(true); expect(StyleSheet.flatten((meter.children[0] as any).props.style).width).toBe('50%');
    await poll({ durationMillis: 2000 });
    expect(jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(c => c[0])).toEqual([t('editorVoiceover.asking'), t('editorVoiceover.started')]);
});
test('ignores initial false poll, then detects an established recording interruption', async () => {
    await render(); await press('editorVoiceover.record'); await poll({ isRecording: false }); expect(mockStop).not.toHaveBeenCalled();
    await poll({ isRecording: true, durationMillis: 100 }); await poll({ isRecording: false, durationMillis: 200 });
    expect(mockStop).toHaveBeenCalledTimes(1); expect(mockHook.message).toBe(t('editorVoiceover.interrupted')); expect(mockHook.phase).toBe('review');
});
test('no recording poll within 1500ms fails startup and deletes its file', async () => {
    await render(); await press('editorVoiceover.record'); await act(async () => jest.advanceTimersByTimeAsync(1500));
    expect(mockHook.phase).toBe('idle'); expect(mockHook.message).toBe(t('editorVoiceover.interrupted')); expect(mockDiscard).toHaveBeenCalledWith('file://native.wav');
});
test('a throwing record fails startup and restores speaker playback', async () => {
    mockRecord.mockImplementation(() => { throw Error('native'); }); await render(); await press('editorVoiceover.record');
    expect(mockHook.phase).toBe('idle'); expect(mockDiscard).toHaveBeenCalledWith('file://native.wav'); expect(mockMode).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true });
});
test.each(['poll', 'finished'] as const)('native cap through %s is not an interruption', async mode => {
    mockStartFrame = 17400; await render(); await press('editorVoiceover.record'); expect(mockRecord).toHaveBeenCalledWith({ forDuration: 20 });
    if (mode === 'poll') await poll({ durationMillis: 20000, isRecording: false });
    else await act(async () => mockStatus({ isFinished: true, hasError: false }));
    expect(mockHook.message).toBe(t('editorVoiceover.limitReached')); expect(mockHook.phase).toBe('review');
});
test.each(['background', 'ready', 'error', 'reset'] as const)('%s stops recording and preserves the take', async reason => {
    await render(); await press('editorVoiceover.record'); await poll({ isRecording: true, durationMillis: 100 });
    if (reason === 'background') await app('background');
    if (reason === 'ready') { mockReady = false; await render(); }
    if (reason === 'error') await act(async () => mockStatus({ hasError: true }));
    if (reason === 'reset') await poll({ mediaServicesDidReset: true });
    expect(mockHook.take).toBe('file://take.wav'); expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockHook.message).toBe(t(reason === 'background' || reason === 'ready' ? 'editorVoiceover.backgrounded' : 'editorVoiceover.interrupted'));
    if (reason === 'ready') expect(root.container.queryAll(node => node.props.accessibilityViewIsModal && node.props.visible === true)).toHaveLength(0);
});
test('empty native URI reports no capture', async () => {
    await render(); await press('editorVoiceover.record'); mockRecorder.uri = ''; await press('editorVoiceover.stop'); expect(mockHook.phase).toBe('idle'); expect(mockHook.message).toBe(t('editorVoiceover.empty'));
});
test('Re-record deletes the previous take; Close stops before asking and Discard deletes', async () => {
    await review(); await press('editorVoiceover.rerecord'); expect(mockDiscard).toHaveBeenCalledWith('file://take.wav');
    await press('editorVoiceover.close'); expect(mockHook.phase).toBe('review');
    expect(Alert.alert).toHaveBeenCalledWith(t('editorVoiceover.discardTitle'), undefined, expect.any(Array));
    await act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.style === 'destructive')!.onPress!());
    expect(mockClosed).toHaveBeenCalledTimes(1); expect(mockHook.take).toBeNull();
});
test('account change stops, deletes and closes without retaining a take', async () => {
    await render(); await press('editorVoiceover.record'); await act(async () => { mockOwner = 'another'; mockOwners.forEach(fn => fn()); });
    expect(mockStop).toHaveBeenCalled(); expect(mockDiscard).toHaveBeenCalledWith('file://native.wav'); expect(mockClosed).toHaveBeenCalledTimes(1); expect(mockHook.take).toBeNull();
});
for (const stage of ['permission', 'mode', 'prepare'] as const) {
    test.each(['ready', 'close', 'background', 'unmount'] as const)(`${stage} pending then %s never records`, async event => {
        const gate = deferred<any>();
        (stage === 'permission' ? mockGet : stage === 'mode' ? mockMode : mockPrepare).mockReturnValueOnce(gate.promise);
        await render(); await press('editorVoiceover.record');
        if (event === 'ready') { mockReady = false; await render(); }
        if (event === 'close') await press('editorVoiceover.close');
        if (event === 'background') await app('background');
        if (event === 'unmount') await act(async () => root.unmount());
        await act(async () => gate.resolve({ granted: true }));
        expect(mockRecord).not.toHaveBeenCalled(); expect(mockMode).toHaveBeenLastCalledWith({ allowsRecording: false, playsInSilentMode: true }); expect(mockDiscard).toHaveBeenCalledWith('file://native.wav');
    });
}
test('Add verifies WAV and duration, requires a durable copy, then removes the take', async () => {
    await review(); await press('editorVoiceover.add');
    expect(mockRead).toHaveBeenCalledWith(12); expect(mockHandleClose).toHaveBeenCalledTimes(1);
    expect(mockCopy).toHaveBeenCalledWith({ uri: 'file://take.wav', mimeType: 'audio/wav', duration: 3000 }, 'l-11111111-1111-4111-8111-111111111111', 'audio', true);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'audio', frames: 90, hasAudio: true, width: 0, height: 0 })); expect(mockAdded).toHaveBeenCalledTimes(1); expect(mockEnd).toHaveBeenCalledTimes(1);
});
test.each(['header', 'probe', 'copy', 'track', 'full', 'throw', 'no-token', 'invalid-token'] as const)('%s refusal settles Add back to review with the take', async failure => {
    await review();
    if (failure === 'header') mockRead.mockResolvedValue(new Uint8Array(12));
    if (failure === 'probe') mockProbe.mockResolvedValue(null);
    if (failure === 'copy') mockCopy.mockResolvedValue(null);
    if (failure === 'track' || failure === 'full') mockInsert.mockReturnValue(failure);
    if (failure === 'throw') mockCopy.mockRejectedValue(Error('copy'));
    if (failure === 'no-token') mockBegin.mockReturnValue(null);
    if (failure === 'invalid-token') mockValid.mockReturnValue(false);
    await press('editorVoiceover.add'); enabledReview(); expect(mockAdded).not.toHaveBeenCalled();
    const messages = { header: t('editorVoiceover.unreadable'), probe: t('editorVoiceover.unreadable'), copy: t('editorVoiceover.addFailed'), track: t('editor.unlockoraddatrackfirst', { value1: 'audio' }), full: t('editorAi.projectFull'), throw: t('editorVoiceover.addFailed'), 'no-token': t('editorSave.importDropped') };
    if (failure !== 'invalid-token') expect(mockHook.message).toBe(messages[failure]);
    expect(mockEnd).toHaveBeenCalledTimes(failure === 'no-token' ? 0 : 1);
});
for (const stage of ['probe', 'copy'] as const) {
    test.each(['background', 'ready'] as const)(`${stage} pending across %s settles and permits a successful second Add`, async event => {
        await review(); const gate = deferred<number>(); (stage === 'probe' ? mockProbe : mockCopy).mockReturnValueOnce(gate.promise);
        await press('editorVoiceover.add'); expect(mockHook.phase).toBe('adding');
        expect(button('editorVoiceover.close').props.accessibilityState.disabled).toBe(true); expect(button('editorVoiceover.discard').props.accessibilityState.disabled).toBe(true);
        if (event === 'background') { await app('background'); await app('active'); }
        else { mockReady = false; await render(); mockReady = true; await render(); }
        await act(async () => gate.resolve(3)); enabledReview(); expect(mockHook.message).toBeNull(); expect(mockInsert).not.toHaveBeenCalled(); expect(mockEnd).toHaveBeenCalledTimes(1);
        await press('editorVoiceover.add'); expect(mockAdded).toHaveBeenCalledTimes(1); expect(mockEnd).toHaveBeenCalledTimes(2);
    });
}
test('unmount during copy ends the token without insert or callbacks', async () => {
    await review(); const gate = deferred<number>(); mockCopy.mockReturnValueOnce(gate.promise); await press('editorVoiceover.add');
    await act(async () => root.unmount()); await act(async () => gate.resolve(3));
    expect(mockInsert).not.toHaveBeenCalled(); expect(mockAdded).not.toHaveBeenCalled(); expect(mockClosed).not.toHaveBeenCalled(); expect(mockEnd).toHaveBeenCalledTimes(1);
});

test('a cancelled Add resolving after a new Record cannot overwrite its recording phase', async () => {
    await review(); const gate = deferred<number>(); mockCopy.mockReturnValueOnce(gate.promise); await press('editorVoiceover.add');
    await app('background'); await app('active'); enabledReview(); await press('editorVoiceover.rerecord');
    expect(mockHook.phase).toBe('recording'); await act(async () => gate.resolve(3));
    expect(mockHook.phase).toBe('recording'); expect(mockInsert).not.toHaveBeenCalled(); expect(mockEnd).toHaveBeenCalledTimes(1);
});


test('review supports Play, Pause and restarting a finished take', async () => {
    await review(); await press('editorVoiceover.play'); expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    mockPlayer.playing = true; await press('editorVoiceover.pause'); expect(mockPlayer.pause).toHaveBeenCalled();
    mockPlayer.playing = false; mockPlayer.currentTime = mockPlayer.duration;
    await press('editorVoiceover.play'); expect(mockPlayer.seekTo).toHaveBeenCalledWith(0);
    mockPlayer.currentTime = 0;
});
test('owner mismatch discovered after permission await closes without starting', async () => {
    const gate = deferred<any>(); mockGet.mockReturnValueOnce(gate.promise); await render(); await press('editorVoiceover.record');
    mockOwner = 'other'; await act(async () => gate.resolve({ granted: true }));
    expect(mockRecord).not.toHaveBeenCalled(); expect(mockClosed).toHaveBeenCalledTimes(1); expect(mockHook.take).toBeNull();
});


test('unmount retains the native path for deletion if expo releases the recorder before stop resolves', async () => {
    await render(); await press('editorVoiceover.record');
    const gate = deferred<void>(); mockStop.mockReturnValueOnce(gate.promise);
    await act(async () => root.unmount());
    Object.defineProperty(mockRecorder, 'uri', { configurable: true, get() { throw Error('released'); } });
    try {
        await act(async () => gate.resolve());
        expect(mockDiscard).toHaveBeenCalledWith('file://native.wav'); expect(mockAdopt).not.toHaveBeenCalled();
    } finally { Object.defineProperty(mockRecorder, 'uri', { value: 'file://native.wav', writable: true, configurable: true }); }
});

test('permission alert inactive then active preserves the pending Record operation', async () => {
    const permission = deferred<{ granted: boolean }>();
    mockGet.mockResolvedValue({ granted: false, canAskAgain: true }); mockRequest.mockReturnValueOnce(permission.promise);
    await render(); await press('editorVoiceover.record'); expect(mockRequest).toHaveBeenCalledTimes(1);
    await app('inactive'); await app('active'); await act(async () => permission.resolve({ granted: true }));
    expect(mockRecord).toHaveBeenCalledTimes(1); expect(mockHook.phase).toBe('recording'); expect(mockStop).not.toHaveBeenCalled();
});
test('permission lookup can finish while inactive during asking without failing the lifetime fence', async () => {
    const lookup = deferred<{ granted: boolean; canAskAgain: boolean }>(), permission = deferred<{ granted: boolean }>();
    mockGet.mockReturnValueOnce(lookup.promise); mockRequest.mockReturnValueOnce(permission.promise);
    await render(); await press('editorVoiceover.record'); await app('inactive');
    await act(async () => lookup.resolve({ granted: false, canAskAgain: true }));
    expect(mockHook.phase).toBe('asking'); expect(mockRequest).toHaveBeenCalledTimes(1);
    await app('active'); await act(async () => permission.resolve({ granted: true }));
    expect(mockRecord).toHaveBeenCalledTimes(1); expect(mockHook.phase).toBe('recording');
});
test.each([19499, 19500, 19700])('established stop at %d ms on a 20-second limit uses the 500ms cap tolerance', async durationMillis => {
    mockStartFrame = 17400; await render(); await press('editorVoiceover.record');
    await poll({ isRecording: true, durationMillis: 19000 });
    await poll({ isRecording: false, durationMillis });
    expect(mockHook.phase).toBe('review'); expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockHook.message).toBe(t(durationMillis >= 19500 ? 'editorVoiceover.limitReached' : 'editorVoiceover.interrupted'));
});
test('cap tolerance neither stops a running take early nor establishes a stale idle poll', async () => {
    mockStartFrame = 17400; await render(); await press('editorVoiceover.record');
    await poll({ isRecording: false, durationMillis: 19700 }); expect(mockStop).not.toHaveBeenCalled();
    await poll({ isRecording: true, durationMillis: 19700 }); expect(mockStop).not.toHaveBeenCalled(); expect(mockHook.phase).toBe('recording');
});
test.each(['mode', 'prepare'] as const)('inactive still cancels startup during %s', async stage => {
    const gate = deferred<void>(); (stage === 'mode' ? mockMode : mockPrepare).mockReturnValueOnce(gate.promise);
    await render(); await press('editorVoiceover.record'); await app('inactive'); await app('active');
    await act(async () => gate.resolve()); expect(mockRecord).not.toHaveBeenCalled(); expect(mockHook.phase).toBe('idle');
});
