import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import BeatsHome from '../src/app/(app)/beats';
import BeatEditor from '../src/app/(app)/beats/[id]';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { newBeat, resetBeats, getBeat } from '../src/lib/beatNative/store';
import { audibleGain, addKitTrack, createBeat, eventsAtStep, hasHit, loopSteps, validateBeat, DRUM_PADS, MAX_BPM } from '../src/lib/beatNative/doc';
import { createBeatAudioFromEngine } from '../src/lib/beatNative/audio';

const mockApi = { request: jest.fn() };
const mockPush = jest.fn();
let mockParams: { id: string } = { id: 'x' };
const mockAudio = { play: jest.fn(async () => undefined), stop: jest.fn(), isPlaying: jest.fn(), hitPad: jest.fn(), setTrackMix: jest.fn(), close: jest.fn(async () => undefined) };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: unknown }) => children, Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/lib/beatNative/audio', () => ({ ...jest.requireActual('../src/lib/beatNative/audio'), createBeatAudio: () => mockAudio }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
void [RN.View, RN.ScrollView, RN.Pressable, RN.Text];

let root: Root;
const byLabel = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress ?? n.props.onPressIn) === 'function')[0];
const press = async (label: string) => {
    const n = byLabel(label); if (!n) throw new Error(`no control ${label}`);
    // Pads fire on touch-down for touch and on activate for a screen reader; activate is what the host node exposes here.
    await act(async () => { (n.props.onClick ?? n.props.onPress)({ nativeEvent: {} }); });
};
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); resetBeats(); jest.clearAllMocks(); mockApi.request.mockResolvedValue({ projects: [] }); });
afterEach(async () => { await act(async () => root.unmount()); });

describe('beats home', () => {
    test('off state when the route says unavailable: no new-beat control', async () => {
        mockApi.request.mockRejectedValue(new ApiError(404, 'music_unavailable'));
        await act(async () => root.render(<BeatsHome />));
        expect(text(t('beat.off')).length).toBeGreaterThan(0);
        expect(root.container.queryAll(n => n.props.accessibilityLabel === t('beat.home.new'))).toHaveLength(0);
        expect(mockApi.request).toHaveBeenCalledWith('/api/v1/music/beat-projects');
    });
    test('on: empty list, new beat opens the editor route', async () => {
        await act(async () => root.render(<BeatsHome />));
        expect(text(t('beat.home.empty')).length).toBeGreaterThan(0);
        await press(t('beat.home.new'));
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
    const open = async () => { const doc = newBeat('Test'); mockParams = { id: doc.id }; await act(async () => root.render(<BeatEditor />)); return doc; };
    test('a missing beat shows the empty state', async () => {
        mockParams = { id: 'nope' };
        await act(async () => root.render(<BeatEditor />));
        expect(text(t('beat.missing')).length).toBeGreaterThan(0);
    });
    test('step toggle edits the shared document and passes validation', async () => {
        const doc = await open();
        const label = t('beat.step.off', { n: 2, total: 16, pad: t('beat.pad.kick') });
        await press(label);
        const next = getBeat(doc.id)!;
        expect(hasHit(next, 'kick', 1)).toBe(true);
        expect(validateBeat(next).ok).toBe(true);
        expect(byLabel(t('beat.step.on', { n: 2, total: 16, pad: t('beat.pad.kick') }))).toBeDefined();
    });
    test('pad hit selects the pad, plays it, and the step grid follows', async () => {
        await open();
        await press(t('beat.pad.hit', { pad: t('beat.pad.snare') }));
        expect(mockAudio.hitPad).toHaveBeenCalledWith('snare', '808');
        expect(byLabel(t('beat.step.on', { n: 5, total: 16, pad: t('beat.pad.snare') }))).toBeDefined();
    });
    test('transport: play starts the audio with the live document, stop stops it', async () => {
        await open();
        await press(t('beat.play'));
        expect(mockAudio.play).toHaveBeenCalledTimes(1);
        await press(t('beat.stop'));
        expect(mockAudio.stop).toHaveBeenCalled();
    });
    test('tempo steps change the document and stay inside the limits', async () => {
        const doc = await open();
        await press(t('beat.tempoUp5'));
        expect(getBeat(doc.id)!.tempo.bpm).toBe(97);
        await press(t('beat.tempoDown'));
        expect(getBeat(doc.id)!.tempo.bpm).toBe(96);
        expect(MAX_BPM).toBe(240);
    });
    test('mixer: mute folds into the audio mix, solo and kit change the document', async () => {
        const doc = await open();
        const track = t('beat.track', { n: 1 });
        await press(t('beat.play'));
        await press(t('beat.mute', { track }));
        expect(getBeat(doc.id)!.tracks[0].mute).toBe(true);
        expect(mockAudio.setTrackMix).toHaveBeenCalledWith(doc.tracks[0].id, { gain: 0, pan: 0 });
        await press(t('beat.solo', { track }));
        expect(getBeat(doc.id)!.tracks[0].solo).toBe(true);
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
    test('the Distortion Drive control is not offered', async () => {
        await open();
        expect(root.container.queryAll(n => /drive|distortion/i.test(String(n.props.accessibilityLabel ?? '')))).toHaveLength(0);
    });
    test('every control has an accessible name', async () => {
        await open();
        const unnamed = root.container.queryAll(n => ['button', 'tab'].includes(n.props.accessibilityRole) && !n.props.accessibilityLabel && !n.children.some(c => typeof c === 'string'));
        expect(unnamed.length).toBe(0);
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
        const engine = { context, now: () => now, resume: jest.fn(async () => undefined), close: jest.fn(async () => undefined), playPad: (...a: unknown[]) => { played.push(a); }, playMidi: jest.fn(), click: jest.fn() };
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
