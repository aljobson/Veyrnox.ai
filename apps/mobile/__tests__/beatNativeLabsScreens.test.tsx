import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatTemplatePicker } from '../src/components/beats/BeatTemplatePicker';
import { BeatSoundsSheet } from '../src/components/beats/BeatSoundsSheet';
import { BeatControlsSheet } from '../src/components/beats/BeatControlsSheet';
import { BeatCoachCard } from '../src/components/beats/BeatCoachCard';
import { BeatLabsBar } from '../src/components/beats/BeatLabsBar';
import SongDetail from '../src/app/(app)/music/[id]';
import BeatsHome from '../src/app/(app)/beats';
import * as musicClient from '../src/lib/music/client';
import * as templates from '../src/lib/beatNative/templates';
import { song as songFixture } from './fixtures/music';
import NewSongBeat from '../src/app/(app)/beats/new';
import * as songSeed from '../src/lib/beatNative/songSeed';
import BeatEditor from '../src/app/(app)/beats/[id]';
import { t } from '../src/lib/i18n';
import { BEAT_SHORTCUTS, BEAT_SOUNDS, createBeatFromTemplate, addAudioRegion, soundAsset } from '../src/lib/beatNative/labs';
import { PHONE_CAPABILITIES, SHORTCUT_CAPABILITY } from '../src/lib/beatNative/controls';
import { PHONE_TIP_TARGETS } from '../src/lib/beatNative/coachMarks';
import { beatStore, resetBeats } from '../src/lib/beatNative/store';
import { createTemplateBeat } from '../src/lib/beatNative/templates';
import { fixedDoc, USER, PROJECT, deferred } from './beatNativeFixtures';
import type { MusicSongDetail } from '../src/lib/music/types';
import type { BeatDoc, Edit } from '../src/lib/beatNative/doc';
beforeAll(() => require('../src/lib/beatNative/store').beatStore.setOwner('test-owner'));
const mockPush = jest.fn(), mockReplace = jest.fn(), mockStop = jest.fn(), mockToggle = jest.fn(async () => 'pad');
const mockApi = { request: jest.fn(async () => ({ projects: [] })) };
const mockGetAccessToken = jest.fn(async () => `h.${btoa(JSON.stringify({ sub: USER }))}.s`);
const mockSeen = new Map<string, string>();
const mockDecode = jest.fn();
let mockParams = { id: PROJECT, song: PROJECT, revision: '2' };
let mockPreviewFinish = () => {};
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush, replace: mockReplace }), useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/components/beats/ai/BeatAiPanel', () => ({ BeatAiPanel: () => null }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, getAccessToken: mockGetAccessToken, generation: 0 }) }));
jest.mock('../src/lib/beatNative/persist', () => ({ ...jest.requireActual('../src/lib/beatNative/persist'), documentFiles: () => ({ read: async () => null, write: async () => {}, remove: async () => {}, list: async () => [] }) }));
jest.mock('../src/lib/beatNative/soundPreview', () => ({ createSoundPreview: (_port: unknown, onFinish: () => void) => { mockPreviewFinish = onFinish; return { toggle: mockToggle, stop: mockStop }; } }));
jest.mock('../src/lib/beatNative/audio', () => ({ createBeatAudio: () => ({ close: async () => {}, play: async () => {}, stop: () => {}, hitPad: () => 0, nearestStepAt: () => null }) }));
jest.mock('../src/components/music/MusicPlayer', () => ({ MusicPlayer: () => null }));
jest.mock('../src/components/music/MusicShares', () => ({ MusicShares: () => null }));
jest.mock('../src/components/music/MusicPublication', () => ({ MusicPublication: () => null }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/lib/beatNative/coachMarks', () => ({ ...jest.requireActual('../src/lib/beatNative/coachMarks'), deviceTipStorage: {
    getItem: (key: string) => mockSeen.get(key) ?? null, setItem: (key: string, value: string) => mockSeen.set(key, value),
} }));
jest.mock('../src/lib/beatNative/songSeedNative', () => ({ nativeSeedDeps: () => ({ store: require('../src/lib/beatNative/store').beatStore, online: () => true, currentUserId: () => require('./beatNativeFixtures').USER,
    getSong: mockDecode, fallbackTitle: 'Song' }) }));
void [RN.View, RN.ScrollView, RN.Pressable, RN.Text, RN.Modal, RN.TextInput];
let root: Root;
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const byLabel = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
const press = async (label: string) => { const node = byLabel(label); if (!node) throw new Error(`Missing ${label}`); await act(async () => (node.props.onClick ?? node.props.onPress)({ nativeEvent: {} })); };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); resetBeats(); jest.clearAllMocks(); mockSeen.clear(); mockParams = { id: PROJECT, song: PROJECT, revision: '2' };
    mockToggle.mockReset().mockResolvedValue('pad');
    mockGetAccessToken.mockImplementation(async () => `h.${btoa(JSON.stringify({ sub: USER }))}.s`);
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(async () => { await act(async () => root.unmount()); await beatStore.flushBeats(); jest.restoreAllMocks(); });
test('picker cancel creates nothing; selecting a template persists before opening', async () => {
    const close = jest.fn();
    const pick = jest.fn(async (template: 'hiphop' | 'lofi' | 'house' | 'blank') => { const doc = await createTemplateBeat(beatStore, template, 'Starter'); mockPush(doc.id); });
    await act(async () => root.render(<BeatTemplatePicker onPick={pick} onClose={close} />));
    for (const template of ['hiphop', 'lofi', 'house', 'blank']) expect(byLabel(t(`beatLabs.template.${template}`))).toBeDefined();
    await press(t('beatLabs.cancel')); expect(close).toHaveBeenCalled(); expect(beatStore.listBeats()).toHaveLength(0);
    await press(t('beatLabs.template.lofi')); expect(pick).toHaveBeenCalledWith('lofi');
    const id = mockPush.mock.calls[0][0]; expect(beatStore.saveState(id)).toBe('saved');
});
test('sounds list, filters, empty suggestions, audition, refusal and successful add', async () => {
    const add = jest.fn(() => false), close = jest.fn();
    await act(async () => root.render(<BeatSoundsSheet bpm={92} onAdd={add} onClose={close} />));
    for (const sound of BEAT_SOUNDS) expect(text(t(`beatLabs.sound.${sound.id}`)).length).toBeGreaterThan(0);
    const search = () => root.container.queryAll(n => n.props.accessibilityLabel === t('beatLabs.search') && n.props.onChangeText)[0];
    await act(async () => search().props.onChangeText('WaRm')); expect(text(t('beatLabs.sound.pad')).length).toBeGreaterThan(0);
    await press(t('beatLabs.category.Keys')); expect(text(t('beatLabs.noSounds')).length).toBeGreaterThan(0);
    await press(t('beatLabs.clear')); expect(text(t('beatLabs.sound.sub-one')).length).toBeGreaterThan(0);
    await press(t('beatLabs.auditionNamed', { name: t('beatLabs.sound.pad') })); expect(mockToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'pad' }), 92);
    await press(t('beatLabs.addNamed', { name: t('beatLabs.sound.pad') })); expect(text(t('beatLabs.addFailed')).length).toBeGreaterThan(0); expect(close).not.toHaveBeenCalled();
    add.mockReturnValue(true); await press(t('beatLabs.addNamed', { name: t('beatLabs.sound.pad') })); expect(close).toHaveBeenCalled(); expect(mockStop).toHaveBeenCalled();
});
test('Pattern Labs Sounds stays visible and inserts at tick zero in a new audio lane while Song can hide it', async () => {
    let doc: BeatDoc = { ...fixedDoc(), view: 'pattern' };
    const apply = (operation: Edit) => { doc = operation(doc); return true; };
    const props = { doc, apply, targets: PHONE_TIP_TARGETS, capabilities: PHONE_CAPABILITIES };
    await act(async () => root.render(<BeatLabsBar {...props} />));
    await press(t('beatLabs.sounds'));
    await press(t('beatLabs.addNamed', { name: t('beatLabs.sound.pad') }));
    const audio = doc.tracks.find(track => track.kind === 'audio');
    expect(audio?.regions).toHaveLength(1);
    expect(audio?.regions[0].start).toBe(0);

    await act(async () => root.render(<BeatLabsBar {...props} doc={{ ...doc, view: 'song' }} showSounds={false} />));
    expect(byLabel(t('beatLabs.sounds'))).toBeUndefined();
    expect(byLabel(t('beatLabs.controls'))).toBeDefined();
});
test('all contexts and rows are listed; unavailable capabilities have no touch instructions', async () => {
    const replay = jest.fn(), close = jest.fn();
    await act(async () => root.render(<BeatControlsSheet capabilities={PHONE_CAPABILITIES} canReplay onReplay={replay} onClose={close} />));
    for (const row of BEAT_SHORTCUTS) {
        expect(text(t(`beatLabs.context.${row.context}`)).length).toBeGreaterThan(0);
        expect(text(t(`beatLabs.control.${row.id}`)).length).toBeGreaterThan(0);
        expect(text(t(`beatLabs.touch.${row.id}`)).length > 0).toBe(PHONE_CAPABILITIES.has(SHORTCUT_CAPABILITY[row.id]));
    }
    await press(t('beatLabs.replay')); expect(replay).toHaveBeenCalled(); expect(close).toHaveBeenCalled();
});
test('coach buttons advance, skip and finish; each card announces phone-specific copy', async () => {
    const next = jest.fn(), skip = jest.fn(), announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility');
    await act(async () => root.render(<BeatCoachCard id="grid" last={false} onNext={next} onSkip={skip} />));
    expect(announce).toHaveBeenCalledWith(t('beatLabs.tip.grid')); await press(t('beatLabs.next')); await press(t('beatLabs.skip'));
    expect(next).toHaveBeenCalledTimes(1); expect(skip).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<BeatCoachCard id="shortcuts" last onNext={next} onSkip={skip} />)); await press(t('beatLabs.done')); expect(next).toHaveBeenCalledTimes(2);
});
test('tips persist per account, skip absent targets, and replay from Controls', async () => {
    const song = { ...fixedDoc(), view: 'song' as const };
    const props = { doc: song, apply: () => true, targets: PHONE_TIP_TARGETS, capabilities: PHONE_CAPABILITIES };
    await act(async () => root.render(<BeatLabsBar {...props} />));
    // Song view: the step grid is not on screen, so its tip is skipped.
    expect(text(t('beatLabs.tip.grid'))).toHaveLength(0);
    for (const id of ['library', 'play', 'arrangement']) { expect(text(t(`beatLabs.tip.${id}`)).length).toBeGreaterThan(0); await press(t('beatLabs.next')); }
    expect(text(t('beatLabs.tip.shortcuts')).length).toBeGreaterThan(0); expect(text(t('beatLabs.tip.export'))).toHaveLength(0); await press(t('beatLabs.done'));
    expect(mockSeen.size).toBe(1); await act(async () => root.unmount()); root = createRoot(); await act(async () => root.render(<BeatLabsBar {...props} />));
    expect(text(t('beatLabs.tip.library'))).toHaveLength(0); await press(t('beatLabs.controls')); await press(t('beatLabs.replay'));
    expect(text(t('beatLabs.tip.library')).length).toBeGreaterThan(0); await press(t('beatLabs.skip')); expect(text(t('beatLabs.tip.library'))).toHaveLength(0);
});
test('pattern view shows the grid tip, never the arrangement tip, and a view change mid-tour moves forward', async () => {
    const pattern = { ...fixedDoc(), view: 'pattern' as const };
    const props = { apply: () => true, targets: PHONE_TIP_TARGETS, capabilities: PHONE_CAPABILITIES };
    await act(async () => root.render(<BeatLabsBar doc={pattern} {...props} />));
    for (const id of ['grid', 'library']) { expect(text(t(`beatLabs.tip.${id}`)).length).toBeGreaterThan(0); await press(t('beatLabs.next')); }
    expect(text(t('beatLabs.tip.play')).length).toBeGreaterThan(0); await press(t('beatLabs.next'));
    expect(text(t('beatLabs.tip.arrangement'))).toHaveLength(0); expect(text(t('beatLabs.tip.shortcuts')).length).toBeGreaterThan(0);
    // Switching to Song view while on the last pattern tip does not go back to earlier tips.
    await act(async () => root.render(<BeatLabsBar doc={{ ...pattern, view: 'song' }} {...props} />));
    expect(text(t('beatLabs.tip.shortcuts')).length).toBeGreaterThan(0); expect(text(t('beatLabs.tip.library'))).toHaveLength(0);
});
test('signed-out editor hides first-run tips and the replay action', async () => {
    mockGetAccessToken.mockResolvedValue('');
    await act(async () => root.render(<BeatLabsBar doc={fixedDoc()} apply={() => true} targets={PHONE_TIP_TARGETS} capabilities={PHONE_CAPABILITIES} />));
    expect(text(t('beatLabs.tip.grid'))).toHaveLength(0);
    await press(t('beatLabs.controls'));
    expect(byLabel(t('beatLabs.replay'))).toBeUndefined();
});
test.each(['hiphop', 'lofi'] as const)('%s template and added audio expose kit controls only for the drum row', async template => {
    const initial = beatStore.newBeat('MIDI');
    const templateDoc = createBeatFromTemplate({ template, id: initial.id, title: initial.title });
    const doc = addAudioRegion(templateDoc, soundAsset(BEAT_SOUNDS[0], templateDoc.tempo.bpm), undefined, 0);
    expect(doc.tracks.some(track => !track.kind || track.kind === 'drums')).toBe(true);
    expect(doc.tracks.some(track => track.kind === 'midi')).toBe(true);
    expect(doc.tracks.some(track => track.kind === 'audio')).toBe(true);
    expect(beatStore.putBeat(doc)).toBe(true);
    mockParams = { id: initial.id, song: PROJECT, revision: '2' };
    await act(async () => root.render(<BeatEditor />));
    doc.tracks.forEach((track, index) => {
        const label = t('beat.kit', { track: t('beat.track', { n: index + 1 }) });
        const controls = root.container.queryAll(node => node.props.accessibilityLabel === label);
        expect(controls.length > 0).toBe(track.kind !== 'audio' && track.kind !== 'midi');
    });
});
test('non-trashed song detail has Make a beat next to the existing song actions', async () => {
    jest.spyOn(musicClient, 'getSong').mockResolvedValue({ ...songFixture, id: PROJECT, actions: [] } as MusicSongDetail);
    await act(async () => root.render(<SongDetail />)); await press(t('beatLabs.makeBeat'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/beats/new', params: { song: PROJECT } });
});
test('trashed song detail has no Make a beat action', async () => {
    jest.spyOn(musicClient, 'getSong').mockResolvedValue({ ...songFixture, id: PROJECT, lifecycle_status: 'trashed' } as MusicSongDetail);
    await act(async () => root.render(<SongDetail />));
    expect(text(t('music.trashBanner')).length).toBeGreaterThan(0);
    expect(byLabel(t('beatLabs.makeBeat'))).toBeUndefined();
});
test('beats home catches creation failure, shows a notice, and never navigates', async () => {
    jest.spyOn(templates, 'createTemplateBeat').mockRejectedValue(new Error('save_failed'));
    await act(async () => root.render(<BeatsHome />));
    await press(t('beat.home.new')); await press(t('beatLabs.template.blank'));
    expect(text(t('beatLabs.createFailed')).length).toBeGreaterThan(0);
    expect(mockPush).not.toHaveBeenCalled();
});
test('preview preparation is visible, then natural finish restores Audition', async () => {
    const ready = deferred<string>(); mockToggle.mockImplementationOnce(() => ready.promise);
    await act(async () => root.render(<BeatSoundsSheet bpm={92} onAdd={() => true} onClose={() => {}} />));
    const name = t('beatLabs.sound.pad');
    await press(t('beatLabs.auditionNamed', { name }));
    expect(text(t('beatLabs.previewLoading')).length).toBeGreaterThan(0);
    await act(async () => { ready.resolve('pad'); });
    expect(text(t('beatLabs.previewLoading'))).toHaveLength(0);
    expect(byLabel(t('beatLabs.stopNamed', { name }))).toBeDefined();
    await act(async () => mockPreviewFinish());
    expect(byLabel(t('beatLabs.auditionNamed', { name }))).toBeDefined();
    expect(byLabel(t('beatLabs.stopNamed', { name }))).toBeUndefined();
});
test('song route effect replay shares one load, error offers retry and library', async () => {
    mockDecode.mockRejectedValue({ status: 404 });
    await act(async () => root.render(<StrictMode><NewSongBeat /></StrictMode>));
    expect(mockDecode).toHaveBeenCalledTimes(1); expect(text(t('beatLabs.seed.error.r34')).length).toBeGreaterThan(0);
    await press(t('beat.retry')); expect(mockDecode).toHaveBeenCalledTimes(2);
    await press(t('beatLabs.backLibrary')); expect(mockReplace).toHaveBeenCalledWith('/music');
});

test('successful seed route replaces itself with the editor; unmount releases its load', async () => {
    const session = { acquire: jest.fn(async () => PROJECT), release: jest.fn(), abort: jest.fn() };
    jest.spyOn(songSeed, 'createSeedSession').mockReturnValue(session);
    await act(async () => root.render(<NewSongBeat />));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/beats/[id]', params: { id: PROJECT } });
    await act(async () => root.unmount()); expect(session.release).toHaveBeenCalledTimes(1); root = createRoot();
});
