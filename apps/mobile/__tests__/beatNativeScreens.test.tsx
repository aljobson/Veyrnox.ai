import * as recordingHook from '../src/lib/beatNative/useTakeRecording';
import { beforeReplace } from '../src/lib/beatNative/recordingFinalizers';
import type { RecordingEdit } from '../src/lib/beatNative/takeShared';
import { addAudioTrack, commitRecording, putBeatTake, takeAsset, configureBeatTakeStorage } from '../src/lib/beatNative/takeShared';
import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import { takeIO, takeRow } from './beatNativeTakeFixtures';
import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import BeatsHome from '../src/app/(app)/beats';
import BeatEditor from '../src/app/(app)/beats/[id]';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { beatStore, createBeatStore, newBeat, resetBeats, getBeat, putBeat } from '../src/lib/beatNative/store';
import { audibleGain, addKitTrack, createBeat, eventsAtStep, hasHit, loopSteps, patternHasHits, selectPattern, validateBeat, DRUM_PADS, MAX_BPM, setView } from '../src/lib/beatNative/doc';
import { BeatVersionsSheet } from '../src/components/beats/BeatVersionsSheet';
import { BeatCloudConflictModal } from '../src/components/beats/BeatCloudConflictModal';
import { BeatCloudSync, type SyncView } from '../src/lib/beatNative/cloudSync';
import { deferred, memoryFiles, project, tick, version, USER, OTHER } from './beatNativeFixtures';
import { versionReason, versionTime } from '../src/lib/beatNative/versions';
import type { ApiClient } from '../src/lib/api';
import { createBeatAudioFromEngine } from '../src/lib/beatNative/audio';
import { BeatRecordPanel } from '../src/components/beats/BeatRecordPanel';
import { addInstrumentTrack, asMidiDoc } from '../src/lib/beatNative/midi';
import { bindCacheUser } from '../src/lib/appCache';
jest.mock('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) => require('node:crypto').createHash('sha256').update(value).digest('hex'),
}));
beforeAll(async () => {
    await bindCacheUser(USER);
    require('../src/lib/beatNative/store').beatStore.setOwner(USER);
});

jest.mock('../src/lib/beatNative/persist', () => {
    const actual = jest.requireActual('../src/lib/beatNative/persist');
    const data = new Map<string, string>();
    return { ...actual, documentFiles: () => ({
        read: async (name: string) => data.get(name) ?? null,
        write: async (name: string, value: string) => { data.set(name, value); },
        remove: async (name: string) => { data.delete(name); },
        list: async () => [...data.keys()],
    }) };
});

let mockExportProps: { prepare(): Promise<void>; recording: boolean; replacing: boolean } | undefined;
jest.mock('../src/components/beats/BeatExportSheet', () => ({ BeatExportSheet: (props: typeof mockExportProps) => { mockExportProps = props; return null; } }));
const mockApi = { request: jest.fn() };
const mockGetAccessToken = jest.fn(async () => `h.${btoa(JSON.stringify({ sub: USER }))}.s`);
const mockBeginSessionTask = () => ({ gen: mockGeneration, user: USER, current: () => true,
    tokens: Object.assign(mockGetAccessToken, { generation: () => mockGeneration, expected: mockGeneration }) });
let mockGeneration = 0;
const mockPush = jest.fn();
let mockParams: { id: string } = { id: 'x' };
const mockAudio = {
    play: jest.fn(async (): Promise<'started' | 'cancelled' | 'busy'> => 'started'),
    stop: jest.fn(), isPlaying: jest.fn(), hitPad: jest.fn(() => 4.2),
    nearestStepAt: jest.fn(() => ({ step: 3, time: 4.1 })),
    setTrackMix: jest.fn(), close: jest.fn(async () => undefined),
    now: jest.fn(() => 1), releaseKeys: jest.fn(), noteOn: jest.fn(async () => undefined), noteOff: jest.fn(),
    playRange: jest.fn(async () => ({ contextStart: 1, recordContextStart: 1 })),
};
const mockCreateBeatAudio = jest.fn(() => mockAudio);
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, getAccessToken: mockGetAccessToken,
    generation: mockGeneration, beginSessionTask: mockBeginSessionTask }) }));
jest.mock('../src/components/beats/ai/BeatAiPanel', () => ({ BeatAiPanel: () => null }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: unknown }) => children, Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/lib/beatNative/audio', () => ({ ...jest.requireActual('../src/lib/beatNative/audio'), createBeatAudio: () => mockCreateBeatAudio() }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
void [RN.View, RN.ScrollView, RN.Pressable, RN.Text, RN.Modal];

let root: Root;
const byLabel = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress ?? n.props.onPressIn) === 'function')[0];
const press = async (label: string) => {
    const n = byLabel(label); if (!n) throw new Error(`no control ${label}`);
    // Pads fire on touch-down for touch and on activate for a screen reader; activate is what the host node exposes here.
    await act(async () => { (n.props.onClick ?? n.props.onPress)({ nativeEvent: {} }); });
};
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const testId = (value: string) => root.container.queryAll(n => n.props.testID === value);
beforeEach(() => { configureBeatTakeStorage(createTakeFiles(takeIO())); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); resetBeats(); jest.clearAllMocks(); mockCreateBeatAudio.mockImplementation(() => mockAudio); mockAudio.now.mockReturnValue(1); mockAudio.playRange.mockResolvedValue({ contextStart: 1, recordContextStart: 1 }); jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() })); mockGeneration = 0; mockGetAccessToken.mockImplementation(async () => `h.${btoa(JSON.stringify({ sub: USER }))}.s`); mockApi.request.mockResolvedValue({ projects: [] }); });
afterEach(async () => { await act(async () => root.unmount()); });

describe('beats home', () => {
    test('off state keeps local controls and makes only the probe call', async () => {
        mockApi.request.mockRejectedValue(new ApiError(404, 'music_unavailable'));
        await act(async () => root.render(<BeatsHome />));
        expect(text(t('beat.cloud.off')).length).toBeGreaterThan(0);
        expect(byLabel(t('beat.home.new'))).toBeDefined();
        expect(mockApi.request).toHaveBeenCalledTimes(1);
        expect(mockApi.request).toHaveBeenCalledWith('/api/v1/music/beat-projects', expect.any(Object), expect.any(Object));
    });
    test('on: empty list, new beat opens the editor route', async () => {
        await act(async () => root.render(<BeatsHome />));
        expect(text(t('beat.home.empty')).length).toBeGreaterThan(0);
        await press(t('beat.home.new'));
        expect(mockPush).not.toHaveBeenCalled();
        await press(t('beatLabs.template.blank'));
        expect(mockPush).toHaveBeenCalledTimes(1);
        const id = (mockPush.mock.calls[0][0] as { params: { id: string } }).params.id;
        expect(getBeat(id)?.title).toBe(t('beat.home.untitled', { n: 1 }));
    });
    test('offline still lets a beat be made, with a notice', async () => {
        mockApi.request.mockRejectedValue(new ApiError(0, 'network'));
        await act(async () => root.render(<BeatsHome />));
        expect(text(t('beat.offline')).length).toBeGreaterThan(0);
        expect(byLabel(t('beat.home.new'))).toBeDefined();
    });
});

describe('beat editor', () => {
    // Pads and the step grid live in Pattern view since N3; new beats retain the web Song default.
    const open = async () => { const doc = setView(newBeat('Test'), 'pattern'); putBeat(doc); mockParams = { id: doc.id }; await act(async () => root.render(<BeatEditor />)); return doc; };
    test('a missing beat shows the empty state', async () => {
        mockParams = { id: 'nope' };
        await act(async () => root.render(<BeatEditor />));
        expect(text(t('beat.missing')).length).toBeGreaterThan(0);
    });
    test('step toggle edits the shared document and passes validation', async () => {
        const doc = await open();
        const label = t('beat.step.off', { n: 2, total: 16, pad: t('beat.pad.kick') });
        expect(testId('step-selected-1')).toHaveLength(0);
        await press(label);
        const next = getBeat(doc.id)!;
        expect(hasHit(next, 'kick', 1)).toBe(true);
        expect(validateBeat(next).ok).toBe(true);
        expect(byLabel(t('beat.step.on', { n: 2, total: 16, pad: t('beat.pad.kick') }))).toBeDefined();
        expect(testId('step-selected-1')).toHaveLength(1);
    });
    test('pad hit selects the pad, plays it, and the step grid follows', async () => {
        await open();
        expect(testId('pad-selected-kick')).toHaveLength(1);
        await press(t('beat.pad.hit', { pad: t('beat.pad.snare') }));
        expect(mockAudio.hitPad).toHaveBeenCalledWith('snare', '808');
        expect(byLabel(t('beat.step.on', { n: 5, total: 16, pad: t('beat.pad.snare') }))).toBeDefined();
        expect(testId('pad-selected-kick')).toHaveLength(0);
        expect(testId('pad-selected-snare')).toHaveLength(1);
    });
    test('pad recording off or armed while stopped auditions without writing', async () => {
        const doc = await open();
        const clap = t('beat.pad.hit', { pad: t('beat.pad.clap') });
        await press(clap);
        expect(mockAudio.hitPad).toHaveBeenLastCalledWith('clap', '808');
        expect(getBeat(doc.id)!.patterns.A.rows.clap).toEqual([]);
        expect(mockAudio.nearestStepAt).not.toHaveBeenCalled();

        await press(t('beat.padRecord.enable'));
        expect(text(t('beat.padRecord.status.armed')).length).toBeGreaterThan(0);
        await press(clap);
        expect(getBeat(doc.id)!.patterns.A.rows.clap).toEqual([]);
        expect(mockAudio.nearestStepAt).not.toHaveBeenCalled();
    });
    test('armed ordinary playback records one undoable nearest-step hit and Stop preserves arming', async () => {
        const doc = await open();
        const clap = t('beat.pad.hit', { pad: t('beat.pad.clap') });
        await press(t('beat.padRecord.enable'));
        await press(t('beat.play'));
        expect(text(t('beat.padRecord.status.recording')).length).toBeGreaterThan(0);
        await press(clap);
        expect(mockAudio.nearestStepAt).toHaveBeenLastCalledWith(4.2);
        expect(getBeat(doc.id)!.patterns.A.rows.clap).toEqual([[3, 100]]);

        // Recording the same pad into the same destination is an identity edit, not another history entry.
        await press(clap);
        expect(getBeat(doc.id)!.patterns.A.rows.clap).toEqual([[3, 100]]);
        await press(t('beat.undo'));
        expect(getBeat(doc.id)!.patterns.A.rows.clap).toEqual([]);

        await press(t('beat.stop'));
        expect(text(t('beat.padRecord.status.armed')).length).toBeGreaterThan(0);
        expect(byLabel(t('beat.padRecord.disable')).props.accessibilityState.selected).toBe(true);
    });
    test('Song pad recording uses the selected drum region pattern and offset', async () => {
        const doc = structuredClone(addKitTrack(newBeat('Song record'), 'lofi'));
        const selectedTrack = doc.tracks[1];
        const region = selectedTrack.regions[0];
        region.pattern = 'B'; region.offset = 480;
        putBeat(doc); mockParams = { id: doc.id };
        mockAudio.nearestStepAt.mockReturnValueOnce({ step: 4, time: 4.1 });
        await act(async () => root.render(<BeatEditor />));
        await press(selectedTrack.name);
        await press(t('beat.padRecord.enable'));
        await press(t('beat.play'));
        await press(t('beat.pad.hit', { pad: t('beat.pad.clap') }));
        expect(getBeat(doc.id)!.patterns.B.rows.clap).toEqual([[6, 100]]);
        expect(getBeat(doc.id)!.patterns.A.rows.clap).toEqual([]);
    });
    test('Song pad recording refuses a gap without mutating the current pattern', async () => {
        const doc = structuredClone(newBeat('Song gap'));
        doc.tracks[0].regions[0].length = 960;
        putBeat(doc); mockParams = { id: doc.id };
        mockAudio.nearestStepAt.mockReturnValueOnce({ step: 8, time: 4.1 });
        await act(async () => root.render(<BeatEditor />));
        await press(t('beat.padRecord.enable'));
        await press(t('beat.play'));
        await press(t('beat.pad.hit', { pad: t('beat.pad.clap') }));
        expect(getBeat(doc.id)!.patterns.A.rows.clap).toEqual([]);
        expect(RN.AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
            t('beat.padRecord.noTarget', { track: doc.tracks[0].name }),
        );
    });
    test('export mount releases playback before the sheet may render, and Play recreates the engine', async () => {
        await open(); await press(t('beat.play')); await press(t('beatExport.title'));
        expect(mockExportProps?.recording).toBe(false);
        await act(async () => { await mockExportProps!.prepare(); });
        expect(mockAudio.stop).toHaveBeenCalled(); expect(mockAudio.close).toHaveBeenCalled();
        expect(byLabel(t('beat.play'))).toBeDefined();
        await press(t('beat.play')); expect(mockAudio.play).toHaveBeenCalledTimes(2);
    });
    test('N7-R4: the editor forwards a held replacement lease to the export sheet', async () => {
        const doc = await open(); await press(t('beatExport.title'));
        let release!: () => void;
        await act(async () => { release = await beforeReplace(doc.id); });
        try { expect(mockExportProps?.replacing).toBe(true); }
        finally { await act(async () => release()); }
        expect(mockExportProps?.replacing).toBe(false);
    });
    test('transport: play starts the audio with the live document, stop stops it', async () => {
        await open();
        await press(t('beat.play'));
        expect(mockAudio.play).toHaveBeenCalledTimes(1);
        await press(t('beat.stop'));
        expect(mockAudio.stop).toHaveBeenCalled();
    });
    test('Song MIDI track exposes the arrangement recorder and its fixed control starts and stops an empty take', async () => {
        const doc = addInstrumentTrack(newBeat('MIDI editor'), { engine: 'voice', id: 'piano', preset: 'grand' });
        const track = doc.tracks.find(item => item.kind === 'midi')!;
        putBeat(doc); mockParams = { id: doc.id };
        await act(async () => root.render(<BeatEditor />));
        await press(track.name);
        expect(testId('beat-midi-record-panel')).toHaveLength(1);
        expect(testId('beat-midi-record-row')).toHaveLength(1);
        await press(t('beat.midiRecord.record'));
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(mockAudio.playRange).toHaveBeenCalledWith(expect.objectContaining({
            startTick: 0, countInBars: 1, assetMode: 'all-supported',
        }));
        expect(byLabel(t('beat.midiRecord.stop'))).toBeDefined();
        await press(t('beat.midiRecord.stop'));
        expect(byLabel(t('beat.midiRecord.record'))).toBeDefined();
    });
    test('Song MIDI records a keyboard chord from a nonzero locator as one exact undoable history entry', async () => {
        const doc = addInstrumentTrack(newBeat('MIDI history'), { engine: 'voice', id: 'piano', preset: 'grand' });
        const track = doc.tracks.find(item => item.kind === 'midi')!;
        putBeat(doc); mockParams = { id: doc.id };
        await act(async () => root.render(<BeatEditor />));
        await press(track.name);
        for (let move = 0; move < 4; move++) await press(t('beat.ruler.right'));
        await press(t('beat.midiRecord.record'));
        await act(async () => { await tick(); });
        expect(mockAudio.playRange).toHaveBeenLastCalledWith(expect.objectContaining({ startTick: 960, countInBars: 1 }));

        const tickSeconds = 60 / (doc.tempo.bpm * 960);
        mockAudio.now.mockReturnValue(1 + 240 * tickSeconds);
        const c4 = testId('beat-key-60').find(node => typeof node.props.onAccessibilityTap === 'function');
        const e4 = testId('beat-key-64').find(node => typeof node.props.onAccessibilityTap === 'function');
        expect(c4).toBeDefined(); expect(e4).toBeDefined();
        await act(async () => {
            c4!.props.onAccessibilityTap();
            e4!.props.onAccessibilityTap();
        });
        expect(mockAudio.noteOn).toHaveBeenCalledWith('touch:60', expect.anything(), 60, 100);
        expect(text(t('beat.midiRecord.recorded', { count: 2 })).length).toBeGreaterThan(0);
        mockAudio.now.mockReturnValue(1 + 360 * tickSeconds);
        await act(async () => { testId('beat-key-60')[0].props.onBlur(); });
        mockAudio.now.mockReturnValue(1 + 480 * tickSeconds);
        await act(async () => { testId('beat-key-64')[0].props.onBlur(); });
        await press(t('beat.midiRecord.stop'));
        await act(async () => { await tick(); });

        const notes = () => Object.values(asMidiDoc(getBeat(doc.id)!).clips).flatMap(clip => clip.notes);
        expect(text(t('beat.midiRecord.status.failed'))).toHaveLength(0);
        expect(byLabel(t('beat.midiRecord.record'))).toBeDefined();
        expect(notes()).toEqual([[1200, 120, 60, 100], [1200, 240, 64, 100]]);
        const recordedMessage = t('beat.midiRecord.recorded', { count: 2 });
        expect(jest.mocked(RN.AccessibilityInfo.announceForAccessibility).mock.calls.filter(([message]) => message === recordedMessage)).toHaveLength(1);
        expect(byLabel(t('beat.undo')).props.accessibilityState?.disabled ?? byLabel(t('beat.undo')).props.disabled).toBe(false);
        await press(t('beat.undo'));
        expect(notes()).toEqual([]);
        expect(byLabel(t('beat.undo')).props.accessibilityState?.disabled ?? byLabel(t('beat.undo')).props.disabled).toBe(true);
        await press(t('beat.redo'));
        expect(notes()).toEqual([[1200, 120, 60, 100], [1200, 240, 64, 100]]);
    });
    test('the persistent transport is a sibling of the scrolling workspace', async () => {
        await open();
        const shell = testId('beat-editor-shell')[0];
        const workspace = testId('beat-editor-workspace')[0];
        const transport = testId('beat-editor-transport')[0];
        expect(shell).toBeDefined(); expect(workspace.parent).toBe(shell); expect(transport.parent).toBe(shell);
        expect(workspace.queryAll(n => n.props.testID === 'beat-editor-transport')).toHaveLength(0);
        for (const label of [t('beat.play'), t('beat.undo'), t('beat.redo'), t('beatMix.title')]) {
            expect(transport.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress) === 'function')).toHaveLength(1);
        }
        expect(transport.props.accessibilityRole).toBe('toolbar');
    });
    test('an account generation change stops and closes the old audio engine', async () => {
        const original = recordingHook.useTakeRecording; let controller!: ReturnType<typeof original>['controller'];
        const hook = jest.spyOn(recordingHook, 'useTakeRecording').mockImplementation((...args) => {
            const result = original(...args); controller = result.controller; return result;
        });
        try {
            await open(); await press(t('beat.play'));
            const finish = jest.spyOn(controller, 'finishAndDisarm');
            mockAudio.stop.mockClear(); mockAudio.close.mockClear(); mockGeneration += 1;
            await act(async () => root.render(<BeatEditor />));
            expect(finish).toHaveBeenCalledTimes(1); expect(mockAudio.stop).toHaveBeenCalledTimes(1); expect(mockAudio.close).toHaveBeenCalledTimes(1);
            expect(byLabel(t('beat.play'))).toBeDefined();
        } finally { hook.mockRestore(); }
    });
    test('a deferred old-owner close cannot close or replace the new-owner engine', async () => {
        const closeGate = deferred<void>();
        const oldEngine = { ...mockAudio, stop: jest.fn(), close: jest.fn(() => closeGate.promise.then(() => undefined)), play: jest.fn(async (): Promise<'started'> => 'started') };
        const newEngine = { ...mockAudio, stop: jest.fn(), close: jest.fn(async () => undefined), play: jest.fn(async (): Promise<'started'> => 'started') };
        mockCreateBeatAudio.mockReset().mockReturnValueOnce(oldEngine).mockReturnValueOnce(newEngine);
        await open(); await press(t('beat.play'));
        expect(oldEngine.play).toHaveBeenCalledTimes(1);
        mockGeneration += 1;
        await act(async () => root.render(<BeatEditor />));
        expect(oldEngine.stop).toHaveBeenCalledTimes(1); expect(oldEngine.close).toHaveBeenCalledTimes(1);
        await press(t('beat.play'));
        expect(newEngine.play).toHaveBeenCalledTimes(1); expect(newEngine.close).not.toHaveBeenCalled();
        closeGate.resolve(); await act(async () => { await closeGate.promise; await tick(); });
        expect(oldEngine.close).toHaveBeenCalledTimes(1); expect(newEngine.close).not.toHaveBeenCalled();
    });
    test('Play shows a cancellable Stop state while audio preloads and cancellation is not an error', async () => {
        const pending = deferred<'cancelled'>(); mockAudio.play.mockReturnValueOnce(pending.promise);
        await open();
        await act(async () => { (byLabel(t('beat.play')).props.onClick ?? byLabel(t('beat.play')).props.onPress)({ nativeEvent: {} }); await Promise.resolve(); });
        expect(byLabel(t('beat.stop'))).toBeDefined();
        await press(t('beat.stop')); pending.resolve('cancelled'); await act(async () => { await pending.promise; });
        expect(mockAudio.stop).toHaveBeenCalled(); expect(byLabel(t('beat.play'))).toBeDefined();
        expect(text(t('beat.audioError'))).toHaveLength(0);
    });
    test('tempo steps change the document and stay inside the limits', async () => {
        const doc = await open();
        await press(t('beat.tempoUp5'));
        expect(getBeat(doc.id)!.tempo.bpm).toBe(97);
        await press(t('beat.tempoDown'));
        expect(getBeat(doc.id)!.tempo.bpm).toBe(96);
        expect(MAX_BPM).toBe(240);
    });
    test('pinned A-D navigation persists without adding an undo entry and the grid follows the selected pattern', async () => {
        const doc = await open();
        const undo = byLabel(t('beat.undo'));
        expect(undo.props.accessibilityState?.disabled ?? undo.props.disabled).toBe(true);
        await press(t('beat.pattern.named', { pattern: 'B' }));
        expect(getBeat(doc.id)!.currentPattern).toBe('B');
        expect(byLabel(t('beat.undo')).props.accessibilityState?.disabled ?? byLabel(t('beat.undo')).props.disabled).toBe(true);
        expect(byLabel(t('beat.step.off', { n: 1, total: 16, pad: t('beat.pad.kick') }))).toBeDefined();
        expect(testId('beat-editor-pattern-selector')).toHaveLength(1);
        expect(testId('beat-editor-workspace')[0].queryAll(n => n.props.testID === 'beat-editor-pattern-selector')).toHaveLength(0);
    });
    test('pattern controls persist swing, metronome and 16/32 length while preserving hidden hits', async () => {
        const doc = await open();
        await press(t('beat.pattern.controlsNamed', { pattern: 'A' }));
        const swing = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === t('beat.pattern.swing'))[0];
        expect(swing.props.accessibilityValue.text).toBe('0%');
        await act(async () => swing.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
        expect(getBeat(doc.id)!.swing).toBe(0.01);
        await press(t('beat.pattern.metronome'));
        expect(getBeat(doc.id)!.metronome).toBe(true);
        expect(testId('beat-pattern-metronome-on')).toHaveLength(1);
        await press(t('beat.pattern.length32'));
        expect(getBeat(doc.id)!.steps).toBe(32);
        await press(t('beat.step.off', { n: 21, total: 32, pad: t('beat.pad.kick') }));
        expect(hasHit(getBeat(doc.id)!, 'kick', 20)).toBe(true);
        await press(t('beat.pattern.length16'));
        expect(getBeat(doc.id)!.steps).toBe(16);
        expect(byLabel(t('beat.step.on', { n: 21, total: 32, pad: t('beat.pad.kick') }))).toBeUndefined();
        expect(hasHit(getBeat(doc.id)!, 'kick', 20)).toBe(true);
        await press(t('beat.pattern.length32'));
        expect(byLabel(t('beat.step.on', { n: 21, total: 32, pad: t('beat.pad.kick') }))).toBeDefined();
    });
    test('copy and clear use overwrite/destructive confirmation and remain one-step undoable edits', async () => {
        const doc = await open();
        const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => undefined);
        try {
            await press(t('beat.pattern.controlsNamed', { pattern: 'A' }));
            await press(t('beat.pattern.copy', { from: 'A', to: 'B' }));
            expect(patternHasHits(getBeat(doc.id)!, 'B')).toBe(true);
            expect(alert).not.toHaveBeenCalled();
            await press(t('beat.undo'));
            expect(patternHasHits(getBeat(doc.id)!, 'B')).toBe(false);
            await press(t('beat.redo'));
            expect(patternHasHits(getBeat(doc.id)!, 'B')).toBe(true);
            await press(t('beat.pattern.copy', { from: 'A', to: 'B' }));
            expect(alert).toHaveBeenLastCalledWith(t('beat.pattern.replaceTitle', { to: 'B' }), t('beat.pattern.replaceBody', { to: 'B' }), expect.any(Array));
            const replace = alert.mock.calls.at(-1)![2]!.find(option => option.style === 'destructive')!;
            await act(async () => replace.onPress?.());
            alert.mockClear();
            await press(t('beat.pattern.clear', { pattern: 'A' }));
            expect(alert).toHaveBeenLastCalledWith(t('beat.pattern.clearTitle', { pattern: 'A' }), t('beat.pattern.clearBody'), expect.any(Array));
            expect(patternHasHits(getBeat(doc.id)!, 'A')).toBe(true);
            const clear = alert.mock.calls.at(-1)![2]!.find(option => option.style === 'destructive')!;
            await act(async () => { putBeat(selectPattern(getBeat(doc.id)!, 'B')); });
            await act(async () => clear.onPress?.());
            expect(patternHasHits(getBeat(doc.id)!, 'A')).toBe(true);
            await press(t('beat.pattern.named', { pattern: 'A' }));
            await press(t('beat.pattern.clear', { pattern: 'A' }));
            const clearCurrent = alert.mock.calls.at(-1)![2]!.find(option => option.style === 'destructive')!;
            await act(async () => clearCurrent.onPress?.());
            expect(patternHasHits(getBeat(doc.id)!, 'A')).toBe(false);
            await press(t('beat.undo'));
            expect(patternHasHits(getBeat(doc.id)!, 'A')).toBe(true);
        } finally { alert.mockRestore(); }
    });
    test('mixer: mute folds into the audio mix, solo and kit change the document', async () => {
        const doc = await open();
        const track = t('beat.track', { n: 1 });
        await press(t('beat.play'));
        await press(t('beat.mute', { track }));
        expect(getBeat(doc.id)!.tracks[0].mute).toBe(true);
        expect(testId(`mute-selected-${doc.tracks[0].id}`)).toHaveLength(1);
        expect(mockAudio.setTrackMix).toHaveBeenCalledWith(doc.tracks[0].id, { gain: 0, pan: 0 });
        await press(t('beat.solo', { track }));
        expect(getBeat(doc.id)!.tracks[0].solo).toBe(true);
        expect(testId(`solo-selected-${doc.tracks[0].id}`)).toHaveLength(1);
        await press(t('beat.kit.lofi'));
        expect(getBeat(doc.id)!.tracks[0].kit).toBe('lofi');
    });
    test('add and remove a track', async () => {
        const doc = await open();
        await press(t('beat.track.add'));
        expect(getBeat(doc.id)!.tracks).toHaveLength(2);
        await press(t('beat.track.remove', { track: t('beat.track', { n: 2 }) }));
        expect(getBeat(doc.id)!.tracks).toHaveLength(1);
    });
    test('effect controls stay in the mixer sheet rather than the main strip', async () => {
        await open();
        expect(root.container.queryAll(n => /drive|distortion/i.test(String(n.props.accessibilityLabel ?? '')))).toHaveLength(0);
    });
    test('every control has an accessible name', async () => {
        await open();
        const unnamed = root.container.queryAll(n => ['button', 'tab'].includes(n.props.accessibilityRole) && !n.props.accessibilityLabel && !n.children.some(c => typeof c === 'string'));
        expect(unnamed.length).toBe(0);
    });
    test('count-in is a checked switch with a visible non-colour state', async () => {
        const doc = addAudioTrack(newBeat('Record'));
        const controller = { capture: () => null, locked: () => false } as never;
        const view = { status: 'armed', seconds: 0, pass: 1, error: '', armedId: doc.tracks[1].id, denied: false, recovery: [], recoveryFailed: false } as never;
        await act(async () => root.render(<BeatRecordPanel doc={doc} controller={controller} view={view} playing={false} />));
        const control = byLabel(t('beatTakes.countIn'));
        expect(control.props.accessibilityRole).toBe('switch');
        expect(control.props.accessibilityState.checked).toBe(false);
        await press(t('beatTakes.countIn'));
        expect(byLabel(t('beatTakes.countIn')).props.accessibilityState.checked).toBe(true);
        expect(testId('beat-count-in-selected')).toHaveLength(1);
    });
});

describe('document seam', () => {
    test('a new track sounds: it plays the same loop as the first', () => {
        const doc = addKitTrack(createBeat({ id: '00000000-0000-4000-8000-000000000001' }), 'lofi');
        expect(doc.tracks).toHaveLength(2);
        expect(eventsAtStep(doc, 0).filter(e => e.pad === 'kick').map(e => e.trackId).sort()).toEqual(['t1', doc.tracks[1].id].sort());
        expect(loopSteps(doc)).toBe(64);
    });
    test('mute and solo fold into gain as on the web', () => {
        let doc = addKitTrack(createBeat({ id: '00000000-0000-4000-8000-000000000002' }), '808');
        doc = { ...doc, tracks: doc.tracks.map((x, i) => ({ ...x, solo: i === 1 })) };
        expect(audibleGain(doc, doc.tracks[0])).toBe(0);
        expect(audibleGain(doc, doc.tracks[1])).toBe(1);
    });
    test('the phone offers all eight web pads', () => { expect(DRUM_PADS.map(p => p.id)).toHaveLength(8); });
});

describe('audio interface over the engine', () => {
    function fakeEngine() {
        let now = 0;
        const node = () => ({ gain: { value: 1 }, pan: { value: 0 }, connect: jest.fn() });
        const context = { currentTime: 0, sampleRate: 44100, state: 'running', destination: {}, resume: async () => undefined, close: async () => undefined, createGain: node, createStereoPanner: node };
        const played: unknown[][] = [];
        const engine = { context, startRun: (doc: ReturnType<typeof createBeat>) => ({ channels: new Map(doc.tracks.map(t => [t.id, { input: node(), schedule: jest.fn() }])) }), stopRun: jest.fn(), setTrackMix: (run: { channels: Map<string, { input: unknown }> }, id: string) => run.channels.get(id)?.input, meterTap: () => null, live: { bus: {}, channels: new Map() }, now: () => now, resume: jest.fn(async () => undefined), close: jest.fn(async () => undefined), playPad: (...a: unknown[]) => { played.push(a); }, playMidi: jest.fn(), click: jest.fn() };
        return { engine: engine as never, played, advance: (s: number) => { now += s; } };
    }
    test('schedules pad events from the document inside the look-ahead and stops on stop()', async () => {
        const { engine, played, advance } = fakeEngine();
        let fire: () => void = () => undefined;
        const audio = createBeatAudioFromEngine({ engine, setTimer: fn => { fire = fn; return 1; }, clearTimer: () => undefined });
        const doc = createBeat({ id: '00000000-0000-4000-8000-000000000003' });
        const steps: number[] = [];
        await audio.play(() => doc, s => steps.push(s));
        expect(audio.isPlaying()).toBe(true);
        expect(played.length).toBeGreaterThan(0);
        expect(played[0][0]).toBe('kick');
        advance(0.5); fire();
        expect(steps.length).toBeGreaterThan(1);
        audio.stop();
        expect(audio.isPlaying()).toBe(false);
    });
    test('hitPad and setTrackMix reach the engine without a document', () => {
        const { engine, played } = fakeEngine();
        const audio = createBeatAudioFromEngine({ engine });
        audio.hitPad('snare', 'lofi');
        expect(played[0][0]).toBe('snare');
        expect(played[0][4]).toBe('lofi');
        expect(() => audio.setTrackMix('t9', { gain: 0.5, pan: 0.2 })).not.toThrow();
    });
});


describe('save and versions UI', () => {
    const view: SyncView = { state: 'synced', busy: false, conflict: null, detail: false };
    test('editor background and unmount flush immediately, with accessible undo and redo', async () => {
        const listener = jest.spyOn(RN.AppState, 'addEventListener');
        const flush = jest.spyOn(beatStore, 'flushBeats');
        const doc = newBeat('Lifecycle'); mockParams = { id: doc.id };
        await act(async () => root.render(<BeatEditor />));
        await press(t('beat.tempoUp5'));
        await press(t('beat.undo'));
        expect(getBeat(doc.id)?.tempo.bpm).toBe(doc.tempo.bpm);
        await press(t('beat.redo'));
        expect(getBeat(doc.id)?.tempo.bpm).toBe(doc.tempo.bpm + 5);
        const callbacks = listener.mock.calls.filter(([type]) => type === 'change').map(([, callback]) => callback);
        expect(callbacks.length).toBeGreaterThan(0);
        const count = flush.mock.calls.length;
        await act(async () => { callbacks.forEach(callback => callback('background')); });
        expect(flush.mock.calls.length).toBeGreaterThan(count);
        expect(text(t('beat.local.saved')).length).toBeGreaterThan(0);
        await press(t('beat.tempoUp'));
        const beforeUnmount = flush.mock.calls.length;
        await act(async () => root.unmount()); root = createRoot();
        expect(flush.mock.calls.length).toBeGreaterThan(beforeUnmount);
        listener.mockRestore(); flush.mockRestore();
    });
    test('versions has loading, reason/time/revision, and validated restore', async () => {
        const doc = newBeat('Before'), gate = deferred<unknown>();
        const sync = new BeatCloudSync(mockApi as unknown as ApiClient, beatStore, doc.id);
        const apply = jest.fn(() => true), close = jest.fn();
        mockApi.request.mockReturnValueOnce(gate.promise);
        await act(async () => root.render(<BeatVersionsSheet sync={sync} view={view} apply={apply} onClose={close} />));
        expect(text(t('beat.versions.loading')).length).toBeGreaterThan(0);
        await act(async () => { gate.resolve({ versions: [version()] }); });
        expect(text(t('beat.versions.description', { time: versionTime(version().saved_at), revision: 1, reason: versionReason('checkpoint') })).length).toBeGreaterThan(0);
        mockApi.request.mockResolvedValueOnce({ version: version(), doc_json: JSON.stringify({ ...doc, title: 'Restored' }) });
        await press(t('beat.versions.restoreNamed', { title: version().title, revision: 1 }));
        expect(apply).toHaveBeenCalledWith(expect.any(Function), t('beat.versions.restore'));
        expect((apply.mock.calls[0] as unknown as [(doc: unknown) => { title: string }])[0](doc).title).toBe('Restored');
        expect(close).toHaveBeenCalled(); sync.dispose();
    });
    test('bad restored doc shows error and leaves the beat unchanged', async () => {
        const doc = newBeat('Unchanged'), sync = new BeatCloudSync(mockApi as unknown as ApiClient, beatStore, doc.id), apply = jest.fn(() => true);
        mockApi.request.mockResolvedValueOnce({ versions: [version()] });
        await act(async () => root.render(<BeatVersionsSheet sync={sync} view={view} apply={apply} onClose={jest.fn()} />));
        mockApi.request.mockResolvedValueOnce({ version: version(), doc_json: '{}' });
        await press(t('beat.versions.restoreNamed', { title: version().title, revision: 1 }));
        expect(apply).not.toHaveBeenCalled(); expect(getBeat(doc.id)).toEqual(doc);
        expect(text(t('beat.versions.error')).length).toBeGreaterThan(0); sync.dispose();
    });
    test('empty versions, checkpoint action, error/retry and off states', async () => {
        const doc = newBeat('Versions'), sync = new BeatCloudSync(mockApi as unknown as ApiClient, beatStore, doc.id);
        mockApi.request.mockRejectedValueOnce(new ApiError(500, 'error'));
        await act(async () => root.render(<BeatVersionsSheet sync={sync} view={view} apply={() => true} onClose={jest.fn()} />));
        expect(text(t('beat.versions.error')).length).toBeGreaterThan(0);
        mockApi.request.mockResolvedValue({ versions: [] }); await press(t('beat.retry'));
        expect(text(t('beat.versions.empty')).length).toBeGreaterThan(0);
        const checkpoint = jest.spyOn(sync, 'cycle').mockResolvedValue(true);
        await press(t('beat.versions.save')); expect(checkpoint).toHaveBeenCalledWith('checkpoint');
        await act(async () => root.render(<BeatVersionsSheet sync={sync} view={{ ...view, state: 'off' }} apply={() => true} onClose={jest.fn()} />));
        expect(text(t('beat.cloud.off')).length).toBeGreaterThan(0);
        expect(byLabel(t('beat.versions.save'))).toBeUndefined(); sync.dispose();
    });
    test('conflict actions, busy state and error detail are accessible', async () => {
        const doc = newBeat('Conflict'), sync = new BeatCloudSync(mockApi as unknown as ApiClient, beatStore, doc.id);
        const resolve = jest.spyOn(sync, 'resolve').mockResolvedValue(undefined), later = jest.spyOn(sync, 'later').mockImplementation(() => {});
        const conflict = { doc, cloud: { userId: USER, projectId: project(doc.id).id, revision: 3, syncedUpdatedAt: doc.updatedAt } };
        await act(async () => root.render(<BeatCloudConflictModal sync={sync} view={{ ...view, state: 'conflict', conflict, detail: true }} />));
        expect(text(t('beat.conflict.error')).length).toBeGreaterThan(0);
        await press(t('beat.conflict.mine')); expect(resolve).toHaveBeenLastCalledWith('mine');
        await press(t('beat.conflict.theirs')); expect(resolve).toHaveBeenLastCalledWith('theirs');
        await press(t('beat.conflict.later')); expect(later).toHaveBeenCalled();
        await act(async () => root.render(<BeatCloudConflictModal sync={sync} view={{ ...view, state: 'conflict', conflict, busy: true }} />));
        expect(text(t('beat.conflict.busy')).length).toBeGreaterThan(0);
        expect(byLabel(t('beat.conflict.mine'))?.props.accessibilityState?.disabled ?? byLabel(t('beat.conflict.mine'))?.props.disabled).toBe(true);
        sync.dispose();
    });
});


describe('accepted inspection regressions', () => {
    test('home shows only live project links owned by the current account, including account changes', async () => {
        const own = newBeat('Own'), other = newBeat('Other'), removed = newBeat('Removed'), pending = newBeat('Pending');
        beatStore.setCloudLink(own.id, { userId: USER, projectId: project(own.id).id, revision: 2, syncedUpdatedAt: own.updatedAt });
        beatStore.setCloudLink(other.id, { userId: OTHER, projectId: project(other.id).id, revision: 2, syncedUpdatedAt: other.updatedAt });
        beatStore.setCloudLink(removed.id, { userId: USER, projectId: null, revision: 0 });
        beatStore.setCloudLink(pending.id, { userId: USER, projectId: null, revision: 0, syncedUpdatedAt: 0 });
        await act(async () => root.render(<BeatsHome />));
        const count = text(t('beat.cloud.linked')).length; expect(count).toBeGreaterThan(0);
        await act(async () => { beatStore.setCloudLink(own.id, { userId: USER, projectId: null, revision: 0 }); });
        expect(text(t('beat.cloud.linked'))).toHaveLength(0);
        mockGetAccessToken.mockResolvedValue(`h.${btoa(JSON.stringify({ sub: OTHER }))}.s`); mockGeneration++;
        await act(async () => root.render(<BeatsHome />));
        expect(text(t('beat.cloud.linked'))).toHaveLength(count);
    });
    test('removed beat can be linked again from the editor with revision zero', async () => {
        const doc = newBeat('Relink'); mockParams = { id: doc.id };
        beatStore.setCloudLink(doc.id, { userId: USER, projectId: null, revision: 0 });
        mockApi.request.mockImplementation(async (_path, init) => init?.method === 'PUT' ? { project: project(doc.id, 1) } : { projects: [] });
        await act(async () => root.render(<BeatEditor />));
        await press(t('beat.cloud.linkAgain'));
        const put = mockApi.request.mock.calls.find(([, init]) => init?.method === 'PUT');
        expect(put).toBeDefined(); expect(JSON.parse(put![1].body).expected_revision).toBe(0);
        expect(beatStore.getRecord(doc.id)?.cloud?.projectId).toBe(project(doc.id).id);
    });
    test('Decide later has dedicated copy and Choose version reopens the dialog', async () => {
        const doc = newBeat('Pause'); mockParams = { id: doc.id };
        mockApi.request.mockImplementation(async (path, init) => {
            if (init?.method === 'PUT') throw new ApiError(409, 'unknown', { error: { code: 'VERSION_CONFLICT' } });
            return path.endsWith(doc.id) ? { project: project(doc.id, 2), doc_json: JSON.stringify({ ...doc, title: 'Theirs' }) } : { projects: [] };
        });
        await act(async () => root.render(<BeatEditor />)); await press(t('beat.cloud.link'));
        await press(t('beat.conflict.later'));
        expect(text(t('beat.cloud.paused_conflict')).length).toBeGreaterThan(0);
        expect(text(t('beat.cloud.error'))).toHaveLength(0);
        expect(byLabel(t('beat.conflict.mine'))).toBeUndefined();
        await press(t('beat.conflict.choose')); expect(byLabel(t('beat.conflict.mine'))).toBeDefined();
    });
});


test('paused conflict disables checkpoints and explains why in the versions sheet', async () => {
    const doc = newBeat('Paused'), sync = new BeatCloudSync(mockApi as unknown as ApiClient, beatStore, doc.id);
    mockApi.request.mockResolvedValue({ versions: [] });
    await act(async () => root.render(<BeatVersionsSheet sync={sync} view={{ state: 'paused_conflict', busy: false, conflict: null, detail: false }} apply={() => true} onClose={jest.fn()} />));
    const save = byLabel(t('beat.versions.save'));
    expect(save?.props.accessibilityState?.disabled ?? save?.props.disabled).toBe(true);
    expect(text(t('beat.cloud.paused_conflict')).length).toBeGreaterThan(0); sync.dispose();
});

test('an applied restore closes despite a local write failure, retaining the save error', async () => {
    const files = memoryFiles(), store = createBeatStore(files), doc = store.newBeat('Before');
    const sync = new BeatCloudSync(mockApi as unknown as ApiClient, store, doc.id), close = jest.fn();
    const apply = jest.fn((edit: (value: ReturnType<typeof newBeat>) => ReturnType<typeof newBeat>) => store.putBeat(edit(store.getBeat(doc.id)!)));
    mockApi.request.mockResolvedValueOnce({ versions: [version()] });
    await act(async () => root.render(<BeatVersionsSheet sync={sync} view={{ state: 'synced', busy: false, conflict: null, detail: false }} apply={apply} onClose={close} />));
    files.write = async () => { throw new Error('disk_full'); };
    mockApi.request.mockResolvedValueOnce({ version: version(), doc_json: JSON.stringify({ ...doc, title: 'Restored' }) });
    await press(t('beat.versions.restoreNamed', { title: version().title, revision: 1 }));
    expect(store.getBeat(doc.id)?.title).toBe('Restored'); expect(store.saveState(doc.id)).toBe('error');
    expect(close).toHaveBeenCalledTimes(1); expect(text(t('beat.versions.error'))).toHaveLength(0); sync.dispose();
});

test('signed-out home retains local controls and skips the collection probe', async () => {
    mockGetAccessToken.mockResolvedValue('');
    await act(async () => root.render(<BeatsHome />));
    expect(byLabel(t('beat.home.new'))).toBeDefined(); expect(text(t('beat.cloud.signed_out')).length).toBeGreaterThan(0);
    expect(mockApi.request).not.toHaveBeenCalled();
});


test('replacement lease release alone unlocks editor controls and uses cloud-specific copy', async () => {
    const doc = newBeat('Replacement'); mockParams = { id: doc.id };
    await act(async () => root.render(<BeatEditor />)); await press(t('beat.tempoUp'));
    let release!: () => void;
    await act(async () => { release = await beforeReplace(doc.id); });
    const disabled = (label: string) => { const b = byLabel(label); return b?.props.accessibilityState?.disabled ?? b?.props.disabled; };
    expect(disabled(t('beat.play'))).toBe(true); expect(disabled(t('beat.undo'))).toBe(true);
    expect(disabled(t('beat.pattern.named', { pattern: 'A' }))).toBe(true);
    expect(disabled(t('beat.pattern.controlsNamed', { pattern: 'A' }))).toBe(true);
    expect(text(t('beatTakes.replacing')).length).toBeGreaterThan(0);
    await press(t('beat.tempoUp')); expect(text(t('beatTakes.locked'))).toHaveLength(0);
    await act(async () => release());
    expect(disabled(t('beat.play'))).toBe(false); expect(disabled(t('beat.undo'))).toBe(false);
    expect(disabled(t('beat.pattern.named', { pattern: 'A' }))).toBe(false);
    expect(disabled(t('beat.pattern.controlsNamed', { pattern: 'A' }))).toBe(false);
    expect(disabled(t('beatTakes.addTrack'))).toBe(false);
});

test('recording history and announcements use the localized message or fallback, never the web English label', async () => {
    const original = recordingHook.useTakeRecording; let edit!: RecordingEdit;
    const hook = jest.spyOn(recordingHook, 'useTakeRecording').mockImplementation((id, doc, deps) => { edit = deps.edit; return original(id, doc, deps); });
    const announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility');
    try {
        const doc = newBeat('Announcement'); mockParams = { id: doc.id }; await act(async () => root.render(<BeatEditor />));
        const message = t('beatTakes.recorded', { count: 1, take: 1 });
        await act(async () => { edit(d => ({ ...d, title: 'First' }), { recordingCommit: true, label: 'Recorded 1 takes', message }); });
        expect(announce).toHaveBeenCalledWith(message); expect(announce).not.toHaveBeenCalledWith('Recorded 1 takes');
        await act(async () => { edit(d => ({ ...d, title: 'Second' }), { recordingCommit: true, label: 'Recorded 2 takes' }); });
        expect(announce).toHaveBeenCalledWith(t('beatTakes.recordingSaved'));
    } finally { hook.mockRestore(); announce.mockRestore(); }
});

test('a linked beat with a local-only take offers Retry and usable Versions', async () => {
    const original = newBeat('Local take'), row = takeRow('local-only', original.id);
    await putBeatTake(row);
    const audioDoc = addAudioTrack(original);
    beatStore.putBeat(commitRecording(audioDoc, { trackId: audioDoc.tracks.at(-1)!.id, start: 0, length: 1920, takes: [{ asset: takeAsset(row) }] }));
    const doc = getBeat(original.id)!;
    beatStore.setCloudLink(doc.id, { userId: USER, projectId: project(doc.id).id, revision: 1, syncedUpdatedAt: doc.updatedAt });
    mockApi.request.mockImplementation(async (path: string, init: RequestInit) => {
        if (init.method === 'POST') throw new ApiError(400, 'LIMIT_REACHED');
        if (path.endsWith('/versions')) return { versions: [version()] };
        if (path.endsWith('/takes')) return { takes: [] };
        if (path.endsWith(doc.id)) return { project: project(doc.id), doc_json: JSON.stringify(doc) };
        return { projects: [] };
    });
    const retry = jest.spyOn(BeatCloudSync.prototype, 'retry');
    try {
        mockParams = { id: doc.id }; await act(async () => root.render(<BeatEditor />));
        expect(text(t('beat.cloud.takes')).length).toBeGreaterThan(0);
        expect(byLabel(t('beat.retry'))).toBeDefined();
        expect(mockApi.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
        await press(t('beat.retry')); expect(retry).toHaveBeenCalledTimes(1);
        expect(mockApi.request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2);
        await press(t('beat.versions.title'));
        expect(text(t('beat.versions.linkFirst'))).toHaveLength(0);
        expect(byLabel(t('beat.versions.save'))).toBeDefined();
        expect(byLabel(t('beat.versions.restoreNamed', { title: version().title, revision: 1 }))).toBeDefined();
        expect(mockApi.request.mock.calls.some(([path]) => path.endsWith('/versions'))).toBe(true);
    } finally { retry.mockRestore(); }
});
