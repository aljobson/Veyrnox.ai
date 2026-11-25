import { act, type ComponentRef } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import BeatEditor from '../src/app/(app)/beats/[id]';
import { setLocaleFromDevice, t } from '../src/lib/i18n';
import { beatStore, newBeat, resetBeats, getBeat, putBeat, dropBeat } from '../src/lib/beatNative/store';
import { addAudioRegion, addKitTrack, addRegion, copyRegion, deleteRegion, duplicateRegion, moveRegion, removeTrack, resizeRegion, selectPattern, setAudioRegion, setRegionPattern, setView, splitRegion, trimRegionStart, tryOp, validateBeat, type BeatDoc, type Edit } from '../src/lib/beatNative/doc';
import { guardedRippleDelete } from '../src/lib/beatNative/arrange';
import { canUndo, createHistory, record } from '../src/lib/beatNative/history';
import { position, regionLabel } from '../src/lib/beatNative/regionActions';
import type { MeasureAndRevealLaneInput } from '../src/lib/beatNative/clipSearch';
import { BEAT_SOUNDS, soundAsset } from '../src/lib/beatNative/labs';
import { beforeReplace } from '../src/lib/beatNative/recordingFinalizers';
import * as recordingHook from '../src/lib/beatNative/useTakeRecording';
import { restoreBeatLibraryTriggerFocus } from '../src/components/beats/BeatArrangement';
beforeAll(() => require('../src/lib/beatNative/store').beatStore.setOwner('test-owner'));

let mockPutBeatBusy = false;
jest.mock('../src/lib/beatNative/store', () => {
    const actual = jest.requireActual('../src/lib/beatNative/store');
    return { ...actual, putBeat: (doc: BeatDoc) => mockPutBeatBusy ? false : actual.putBeat(doc) };
});
jest.mock('../src/lib/beatNative/persist', () => ({ ...jest.requireActual('../src/lib/beatNative/persist'), documentFiles: () => ({ read: async () => null, write: async () => {}, remove: async () => {}, list: async () => [] }) }));
jest.mock('../src/components/beats/BeatSaveControls', () => ({ BeatSaveControls: () => null }));
jest.mock('../src/components/beats/ai/BeatAiPanel', () => ({ BeatAiPanel: () => null }));
let mockLibrarySheetProps: any, mockSoundsSheetProps: any;
jest.mock('../src/components/beats/BeatSongLibrarySheet', () => ({ BeatSongLibrarySheet: (props: any) => {
    mockLibrarySheetProps = props;
    return require('react').createElement(require('react-native').View, { testID: 'mock-beat-song-library-sheet' });
} }));
jest.mock('../src/components/beats/BeatSoundsSheet', () => ({ BeatSoundsSheet: (props: any) => {
    mockSoundsSheetProps = props;
    return require('react').createElement(require('react-native').View, { testID: 'mock-beat-sounds-sheet' });
} }));
jest.mock('../src/components/beats/BeatExportSheet', () => ({ BeatExportSheet: () => null }));
jest.mock('../src/lib/beatNative/useLocalBeatLifecycle', () => ({ useLocalBeatLifecycle: () => {} }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {}, generation: 0, beginSessionTask: () => ({}) }) }));
const mockMeasureAndRevealLane = jest.fn<void, [MeasureAndRevealLaneInput]>();
jest.mock('../src/lib/beatNative/clipSearch', () => ({
    ...jest.requireActual('../src/lib/beatNative/clipSearch'),
    measureAndRevealLane: (input: MeasureAndRevealLaneInput) => mockMeasureAndRevealLane(input),
}));
const mockAnnounce = jest.fn();
const mockUseAnnouncement = jest.fn((value: string, _options?: { eventKey?: number }) => { if (value) mockAnnounce(value); });
jest.mock('../src/lib/useAnnouncement', () => ({ ...jest.requireActual('../src/lib/useAnnouncement'),
    useAnnouncement: (value: string, options?: { eventKey?: number }) => mockUseAnnouncement(value, options),
}));
const mockAudio = { play: jest.fn(async () => 'started' as const), stop: jest.fn(), close: jest.fn(async () => {}), hitPad: jest.fn(() => 0), nearestStepAt: jest.fn(() => null), setTrackMix: jest.fn() };
jest.mock('../src/lib/beatNative/audio', () => ({ createBeatAudio: () => mockAudio }));
let mockId = '';
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useLocalSearchParams: () => ({ id: mockId }) }));
void [RN.View, RN.ScrollView, RN.Pressable, RN.Text];
let root: Root;
const current = () => getBeat(mockId)!;
const node = (id: string) => root.container.queryAll(n => n.props.testID === id)[0];
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
const field = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];
const press = async (label: string) => {
    const button = control(label); if (!button) throw new Error(`Missing ${label}`);
    await act(async () => (button.props.onClick ?? button.props.onPress)({ nativeEvent: {} }));
};
const pressNode = async (id: string) => {
    const button = node(id); if (!button) throw new Error(`Missing ${id}`);
    await act(async () => (button.props.onClick ?? button.props.onPress)({ nativeEvent: {} }));
};
const touch = (x = 0, y = 0) => ({ nativeEvent: { identifier: 1, pageX: x, pageY: y }, stopPropagation: jest.fn() });
const choose = async (id = 'r1') => { await act(async () => { const props = node(`region-${id}`).props; props.onTouchStart(touch()); props.onTouchEnd(touch()); }); };
const same = (doc: BeatDoc) => ({ ...doc, updatedAt: 0 });
async function open(edit: Edit = d => d) {
    const doc = edit(newBeat('Arrangement')); mockId = doc.id; putBeat(doc);
    await act(async () => root.render(<BeatEditor />)); return doc;
}
async function drag(id: string, dx: number, dy = 0) {
    const props = node(id).props;
    await act(async () => { props.onTouchStart(touch()); jest.advanceTimersByTime(350); });
    await act(async () => props.onTouchMove(touch(dx, dy)));
    await act(async () => props.onTouchEnd(touch(dx, dy)));
}
function rippleDoc(doc: BeatDoc): BeatDoc {
    const next = structuredClone(doc);
    next.tracks[0].regions = [0, 3840, 7680].map((start, i) => ({ id: `r${i}`, start, length: 3840, offset: 0, pattern: 'A' }));
    next.tracks.push({ ...structuredClone(next.tracks[0]), id: 't2', name: 'Second track', regions: [{ ...next.tracks[0].regions[0], id: 'other' }] });
    expect(validateBeat(next).ok).toBe(true);
    return next;
}
function overflowRippleDoc(doc: BeatDoc): BeatDoc {
    const next = structuredClone(doc), lastStart = 511 * 3840;
    next.tempo.bpm = 240;
    next.tracks[0].regions = [
        { id: 'r0', start: 0, length: 3840, offset: 0, pattern: 'A' },
        { id: 'last', start: lastStart, length: 3840, offset: 0, pattern: 'A' },
    ];
    next.cycle = { on: false, start: 0, end: 3840 };
    expect(validateBeat(next).ok).toBe(true);
    return next;
}
function searchManyDoc(doc: BeatDoc): BeatDoc {
    const next = structuredClone(doc);
    next.tracks[0].name = 'Drums Search';
    next.tracks[0].regions = Array.from({ length: 25 }, (_, index) => ({
        id: `search${index}`, start: index * 3840, length: 3840, offset: 0,
        pattern: index === 2 ? 'B' as const : 'A' as const,
    }));
    next.cycle = { on: false, start: 0, end: 4 * 3840 };
    expect(validateBeat(next).ok).toBe(true);
    return next;
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); mockMeasureAndRevealLane.mockReset(); mockPutBeatBusy = false; mockLibrarySheetProps = null; mockSoundsSheetProps = null; setLocaleFromDevice(['en']); resetBeats(); root = createRoot(); });
afterEach(async () => { mockPutBeatBusy = false; await act(async () => root.unmount()); setLocaleFromDevice(['en']); resetBeats(); jest.useRealTimers(); });

test('A1 an old pattern project is migrated into the Music Editor timeline without a view switch', async () => {
    await open(d => setView(d, 'pattern'));
    expect(current().view).toBe('song');
    expect(node('beat-arrangement')).toBeDefined();
    expect(control(t('beat.view.pattern'))).toBeUndefined();
    expect(control(t('beat.view.song'))).toBeUndefined();
    await act(async () => beatStore.flushBeats());
    expect(beatStore.saveState(mockId)).toBe('saved');
});
test.each([
    ['move', 24, 0, (d: BeatDoc) => moveRegion(d, 'r1', 960, 't1')],
    ['lane', 24, 96, (d: BeatDoc) => moveRegion(d, 'r1', 960, d.tracks[1].id)],
    ['copy', 24, 96, (d: BeatDoc) => copyRegion(d, 'r1', 960, d.tracks[1].id)],
    ['trim', 24, 0, (d: BeatDoc) => trimRegionStart(d, 'r1', 960)],
    ['resize', 24, 0, (d: BeatDoc) => resizeRegion(d, 'r1', 16320)],
] as const)('A3 %s commits one undoable web op', async (mode, dx, dy, expected) => {
    const before = await open(d => addKitTrack(d, '808')); await choose();
    if (mode === 'copy') await press(t('beat.region.copy'));
    await drag(mode === 'trim' || mode === 'resize' ? `r1-${mode}` : 'region-r1', dx, dy);
    expect(same(current())).toEqual(same(expected(before))); expect(node('region-preview')).toBeUndefined();
    expect(node('arrangement-scroll').props.scrollEnabled).toBe(true);
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});
test('A3 quick tap and stationary hold select without edits or stuck locks in the editor', async () => {
    const before = await open(); await choose(); expect(same(current())).toEqual(same(before));
    const props = node('region-r1').props;
    await act(async () => { props.onTouchStart(touch()); jest.advanceTimersByTime(350); });
    expect(node('arrangement-scroll').props.scrollEnabled).toBe(false); expect(node('region-preview')).toBeDefined();
    await act(async () => props.onTouchEnd(touch()));
    expect(node('arrangement-scroll').props.scrollEnabled).toBe(true); expect(node('region-preview')).toBeUndefined();
    expect(same(current())).toEqual(same(before)); expect(node('region-inspector')).toBeDefined();
});
const operations: [string, Edit][] = [
    ['earlier', d => moveRegion(d, 'r1', 720, 't1')], ['later', d => moveRegion(d, 'r1', 1200, 't1')],
    ['previousTrack', d => moveRegion(d, 'r1', 960, 't1')], ['nextTrack', d => moveRegion(d, 'r1', 960, d.tracks[1].id)],
    ['shorter', d => resizeRegion(d, 'r1', 15120)], ['longer', d => resizeRegion(d, 'r1', 15600)],
    ['trim', d => trimRegionStart(d, 'r1', 1200)], ['extend', d => trimRegionStart(d, 'r1', 720)],
    ['split', d => splitRegion(d, 'r1', 3840)], ['duplicate', d => duplicateRegion(d, 'r1')], ['delete', d => deleteRegion(d, 'r1')],
];
test.each(operations)('A5 inspector %s matches shared op and undoes', async (name, operation) => {
    const before = await open(d => moveRegion(addKitTrack(d, '808'), 'r1', 960, 't1'));
    await choose(); await press(t('beat.ruler.next')); await press(t(`beat.region.${name}`));
    expect(same(current())).toEqual(same(operation(before)));
    if (name === 'delete') expect(node('region-inspector')).toBeUndefined();
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
});
test('A5 region pattern undoes; shared web history preserves the active pattern selection', async () => {
    const before = await open(); await choose(); await press(t('beat.region.patternNamed', { pattern: 'B' }));
    expect(same(current())).toEqual(same(selectPattern(setRegionPattern(before, 'r1', 'B'), 'B')));
    await press(t('beat.undo')); expect(same(current())).toEqual(same({ ...before, currentPattern: 'B' }));
    await act(async () => putBeat(setRegionPattern(current(), 'r1', 'C'))); await choose();
    expect(current().currentPattern).toBe('C');
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    await press(t('beat.undo')); expect(current().currentPattern).toBe('C');
});
test('A5 refusals surface the existing notice; vanished selection clears after replacement and undo', async () => {
    await open(d => resizeRegion(d, 'r1', 240)); await choose();
    await press(t('beat.region.shorter'));
    expect(mockAnnounce).toHaveBeenCalledWith(t('beat.refused', { reason: 'A region must be at least one step long.' }));
    expect(current().tracks[0].regions[0].length).toBe(240);
    await act(async () => putBeat(deleteRegion(current(), 'r1'))); expect(node('region-inspector')).toBeUndefined();
    await press(t('beat.region.add')); const added = current().tracks[0].regions[0]; await choose(added.id);
    await press(t('beat.undo')); expect(node('region-inspector')).toBeUndefined();
    await press(t('beat.redo')); expect(node('region-inspector')).toBeUndefined();
});
test('ripple defaults off; inspector delete leaves a gap, while enabled delete closes only its lane and undoes once', async () => {
    const before = await open(rippleDoc);
    expect(control(t('beat.ripple.label')).props.accessibilityState.selected).toBe(false);
    expect(control(t('beat.ripple.label')).props.accessibilityLabel).toBe(t('beat.ripple.label'));
    expect(root.container.queryAll(n => n.children.includes(t('beat.ripple.hint')))).toHaveLength(1);
    await choose('r0'); await press(t('beat.region.delete'));
    expect(current().tracks[0].regions.map(region => region.start)).toEqual([3840, 7680]);
    expect(current().tracks[1]).toEqual(before.tracks[1]);
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));

    await press(t('beat.ripple.label')); expect(control(t('beat.ripple.label')).props.accessibilityState.selected).toBe(true);
    await choose('r0'); await press(t('beat.region.delete'));
    expect(current().tracks[0].regions.map(region => region.start)).toEqual([0, 3840]);
    expect(current().tracks[1]).toEqual(before.tracks[1]); expect(current().cycle).toEqual(before.cycle);
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});
test('ripple delete uses the identical policy through the region accessibility action', async () => {
    const before = await open(rippleDoc); await press(t('beat.ripple.label'));
    const props = node('region-r0').props;
    expect(props.accessibilityActions.some((action: { name: string }) => action.name === 'delete')).toBe(true);
    await act(async () => props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } }));
    expect(current().tracks[0].regions.map(region => region.start)).toEqual([0, 3840]);
    expect(current().tracks[1]).toEqual(before.tracks[1]);
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
});
test('insert gap targets the selected region lane at the snapped locator and is one undo entry', async () => {
    const before = await open(rippleDoc);
    expect(control(t('beat.ripple.insert')).props.accessibilityState.disabled).toBe(true);
    await choose('r0'); await press(t('beat.ruler.next')); await press(t('beat.ripple.insert'));
    expect(current().tracks[0].regions.map(region => region.start)).toEqual([0, 7680, 11520]);
    expect(current().tracks[1]).toEqual(before.tracks[1]); expect(current().cycle).toEqual(before.cycle);
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});
test.each([
    ['inside', t('beat.ripple.refusal.inside'), async () => { await choose('r0'); await press(t('beat.ruler.right')); }],
    ['nothing', t('beat.ripple.refusal.nothing'), async () => { await choose('r0'); await press(t('beat.ruler.end')); }],
] as const)('insert gap %s refusal preserves bytes/history and never announces a raw guard code', async (_case, message, locate) => {
    await open(rippleDoc); await locate();
    const before = JSON.stringify(current()); mockAnnounce.mockClear();
    await press(t('beat.ripple.insert'));
    expect(JSON.stringify(current())).toBe(before);
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    expect(mockAnnounce).toHaveBeenCalledWith(t('beat.refused', { reason: message }));
    expect(mockAnnounce.mock.calls.flat().join(' ')).not.toMatch(/ripple_(inside_region|nothing_to_move)/);
});
test('post-guard 512-bar overflow stays unchanged and surfaces localized invalid ripple copy only', async () => {
    await open(overflowRippleDoc); await choose('last');
    await act(async () => node('ruler-position').props.onClick({ nativeEvent: { locationX: 511 * 96 } }));
    const before = JSON.stringify(current()); mockAnnounce.mockClear();
    await press(t('beat.ripple.insert'));
    expect(JSON.stringify(current())).toBe(before);
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    expect(mockAnnounce).toHaveBeenCalledWith(t('beat.refused', { reason: t('beat.ripple.refusal.invalid') }));
    expect(mockAnnounce.mock.calls.flat().join(' ')).not.toMatch(/invalid_ripple|512 bars/);
});
test('take-group ripple refusal preserves document/history and surfaces only localized copy', async () => {
    const { takeRippleFixture } = require('../../../tests/musicBeatRippleFixtures.mjs');
    const doc = takeRippleFixture(), before = JSON.stringify(doc), history = createHistory(doc);
    const result = tryOp(doc, d => guardedRippleDelete(d, 't2', 'before'));
    expect(result.doc).toBe(doc); expect(JSON.stringify(result.doc)).toBe(before);
    expect(result.refused).toBe(t('beat.ripple.refusal.takeGroup')); expect(result.refused).not.toContain('ripple_take_group');
    expect(result.code).toBe('ripple_take_group');
    const next = record(history, result.doc, { label: 'refused ripple' });
    expect(next).toBe(history); expect(canUndo(next)).toBe(false);
});
test('track rename trims, refuses a blank draft without history, enforces 40 characters and undoes once', async () => {
    const before = await open(rippleDoc), name = field(t('beat.track.name'));
    expect(name.props.maxLength).toBe(40); expect(name.props.value).toBe(before.tracks[0].name);
    await act(async () => name.props.onChangeText('  Main drums  ')); await press(t('beat.track.rename'));
    expect(current().tracks[0].name).toBe('Main drums');
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
    await act(async () => field(t('beat.track.name')).props.onChangeText('   ')); mockAnnounce.mockClear();
    const bytes = JSON.stringify(current()); await press(t('beat.track.rename'));
    expect(JSON.stringify(current())).toBe(bytes); expect(field(t('beat.track.name')).props.value).toBe('   ');
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    expect(mockAnnounce).toHaveBeenCalledWith(t('beat.refused', { reason: t('beat.track.nameRequired') }));
});
test('blank rename uses non-English UI and announcement copy without English or raw refusal leakage', async () => {
    setLocaleFromDevice(['es']); await open(rippleDoc);
    await act(async () => field(t('beat.track.name')).props.onChangeText('   ')); mockAnnounce.mockClear();
    const before = JSON.stringify(current()); await press(t('beat.track.rename'));
    expect(JSON.stringify(current())).toBe(before);
    const localized = t('beat.refused', { reason: t('beat.track.nameRequired') });
    expect(mockAnnounce).toHaveBeenCalledWith(localized);
    expect(localized).toContain('Ponle un nombre a la pista.');
    expect(mockAnnounce.mock.calls.flat().join(' ')).not.toMatch(/Give the track a name|track_name_required/);
});
test('read-only arrangement keeps selection but disables every new mutation with non-colour state', async () => {
    await open(d => ({ ...rippleDoc(d), version: 5 }));
    expect(control(t('beat.ripple.label')).props.accessibilityState).toEqual(expect.objectContaining({ selected: false, disabled: true }));
    expect(control(t('beat.ripple.insert')).props.accessibilityState.disabled).toBe(true);
    expect(field(t('beat.track.name')).props.editable).toBe(false);
    await choose('r0'); expect(node('region-inspector')).toBeDefined();
    expect(node('region-r0').props.accessibilityActions).toEqual([{ name: 'activate', label: t('beat.region.select') }]);
    expect(control(t('beat.region.delete')).props.accessibilityState.disabled).toBe(true);
});
test('read-only selection of a non-current Pattern B region is document-byte-identical and history-free', async () => {
    await open(d => {
        const next = rippleDoc(d); next.version = 5; next.tracks[0].regions[0].pattern = 'B';
        expect(next.currentPattern).toBe('A'); expect(validateBeat(next).ok).toBe(true); return next;
    });
    const before = JSON.stringify(current()); await choose('r0');
    expect(node('region-inspector')).toBeDefined(); expect(node('region-r0').props.accessibilityState.selected).toBe(true);
    expect(JSON.stringify(current())).toBe(before); expect(current().currentPattern).toBe('A');
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});
test('clip search exposes help, exact live count, 20-result cap, no-results recovery, Clear and Escape', async () => {
    await open(searchManyDoc);
    expect(node('beat-search-status').props.children).toBe(t('beat.search.help'));
    expect(root.container.queryAll(n => String(n.props.testID ?? '').startsWith('beat-search-result-'))).toHaveLength(0);
    await act(async () => field(t('beat.search.label')).props.onChangeText('DRUMS SEARCH'));
    expect(node('beat-search-status').props.children).toBe(t('beat.search.count', { count: 25, shown: 20 }));
    expect(root.container.queryAll(n => String(n.props.testID ?? '').startsWith('beat-search-result-'))).toHaveLength(20);
    expect(root.container.queryAll(n => n.children.includes(t('beat.search.results')))).toHaveLength(1);

    await act(async () => field(t('beat.search.label')).props.onChangeText('not in this song'));
    expect(node('beat-search-status').props.children).toBe(t('beat.search.count', { count: 0, shown: 0 }));
    expect(root.container.queryAll(n => n.children.includes(t('beat.search.empty', { query: 'not in this song' })))).toHaveLength(1);
    await press(t('beat.search.clear')); expect(field(t('beat.search.label')).props.value).toBe('');
    await act(async () => field(t('beat.search.label')).props.onChangeText('drums'));
    const preventDefault = jest.fn();
    await act(async () => field(t('beat.search.label')).props.onKeyPress({ nativeEvent: { key: 'Escape' }, preventDefault }));
    expect(preventDefault).toHaveBeenCalled(); expect(field(t('beat.search.label')).props.value).toBe('');
});
test('clip search selection resolves track and Pattern B, moves locator and reveals horizontally', async () => {
    const before = await open(searchManyDoc);
    const scrollTo = (RN.ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;
    scrollTo.mockClear();
    await act(async () => field(t('beat.search.label')).props.onChangeText('drums search'));
    await pressNode('beat-search-result-search2');
    expect(node('region-search2').props.accessibilityState.selected).toBe(true);
    expect(current().currentPattern).toBe('B'); expect(current().tracks).toEqual(before.tracks);
    expect(control('Drums Search').props.accessibilityState.selected).toBe(true);
    expect(RN.StyleSheet.flatten(node('playhead').props.style).left).toBe(192);
    expect(scrollTo).toHaveBeenCalledWith({ x: 96, animated: false });
});
test('read-only clip result selection stays byte/history identical while unavailable lane measurement safely preserves horizontal reveal', async () => {
    await open(d => { const next = searchManyDoc(d); next.version = 5; return next; });
    const before = JSON.stringify(current());
    const scrollTo = (RN.ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;
    scrollTo.mockClear();
    await act(async () => field(t('beat.search.label')).props.onChangeText('drums search'));
    await pressNode('beat-search-result-search2');
    expect(node('region-search2').props.accessibilityState.selected).toBe(true);
    expect(JSON.stringify(current())).toBe(before); expect(current().currentPattern).toBe('A');
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ x: 96, animated: false });
    expect(scrollTo.mock.calls.some(([value]) => value?.y !== undefined)).toBe(false);
});
test('a result removed by a document replacement disappears and cannot be selected as stale data', async () => {
    await open(searchManyDoc);
    await act(async () => field(t('beat.search.label')).props.onChangeText('drums search'));
    expect(node('beat-search-result-search2')).toBeDefined();
    await act(async () => putBeat(deleteRegion(current(), 'search2')));
    expect(node('beat-search-result-search2')).toBeUndefined();
    expect(current().currentPattern).toBe('A'); expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});
test('a captured result handler is harmless after its region is removed from the latest document', async () => {
    await open(searchManyDoc);
    await act(async () => field(t('beat.search.label')).props.onChangeText('drums search'));
    const staleButton = node('beat-search-result-search2');
    const stalePress = staleButton.props.onClick ?? staleButton.props.onPress;
    await act(async () => putBeat(deleteRegion(current(), 'search2')));
    const afterDelete = JSON.stringify(current());
    const scrollTo = (RN.ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;
    scrollTo.mockClear();
    await act(async () => stalePress({ nativeEvent: {} }));
    expect(JSON.stringify(current())).toBe(afterDelete);
    expect(current().currentPattern).toBe('A');
    expect(node('region-inspector')).toBeUndefined();
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
});
test.each([
    ['drum', (doc: BeatDoc) => doc.tracks.find(track => !track.kind || track.kind === 'drums')!],
    ['MIDI', (doc: BeatDoc) => doc.tracks.find(track => track.kind === 'midi')!],
] as const)('library placement on a selected %s lane creates and selects one audio lane in one undo step', async (_kind, selected) => {
    const before = await open(mixed);
    const track = selected(current());
    await press(track.name);
    await press(t('beat.library.open'));
    expect(node('mock-beat-song-library-sheet')).toBeDefined();
    const editorLayout = root.container.queryAll(n => String(n.props.testID ?? '').startsWith('beat-editor-layout-'))[0].props.testID;
    expect(mockLibrarySheetProps.layout).toBe(String(editorLayout).replace('beat-editor-layout-', ''));
    expect(mockLibrarySheetProps.placement()).toEqual({ start: 0, trackId: null });
    const asset = soundAsset(BEAT_SOUNDS[0], current().tempo.bpm);
    mockAnnounce.mockClear();
    let committed = false;
    await act(async () => { committed = mockLibrarySheetProps.onCommit(asset, mockLibrarySheetProps.placement()); });
    expect(committed).toBe(true);
    const added = current().tracks.find(item => item.kind === 'audio' && !before.tracks.some(old => old.id === item.id));
    expect(added?.regions).toHaveLength(1);
    expect(added?.regions[0].start).toBe(0);
    expect(control(added!.name).props.accessibilityState.selected).toBe(true);
    expect(mockAnnounce.mock.calls.filter(([message]) => message === t('beat.library.added', { name: asset.name, position: position(0) }))).toHaveLength(1);
    await press(t('beat.undo'));
    expect(same(current())).toEqual(same(before));
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});
test('two identical successful library Adds emit distinct announcement events', async () => {
    const before = await open();
    await press(t('beat.library.open'));
    const asset = soundAsset(BEAT_SOUNDS[0], current().tempo.bpm);
    const intent = mockLibrarySheetProps.placement();
    const message = t('beat.library.added', { name: asset.name, position: position(intent.start) });
    mockAnnounce.mockClear(); mockUseAnnouncement.mockClear();
    await act(async () => { expect(mockLibrarySheetProps.onCommit(asset, intent)).toBe(true); });
    await act(async () => { expect(mockLibrarySheetProps.onCommit(asset, intent)).toBe(true); });
    const events = mockUseAnnouncement.mock.calls
        .filter(([value]) => value === message)
        .map(([, options]) => options?.eventKey);
    expect(events).toHaveLength(2);
    expect(events[0]).not.toBe(events[1]);
    expect(mockAnnounce.mock.calls.filter(([value]) => value === message)).toHaveLength(2);
    await press(t('beat.undo')); await press(t('beat.undo'));
    expect(same(current())).toEqual(same(before));
});
test('library Add preserves snapped locator and selected audio lane across deferred editor drift', async () => {
    const before = await open(mixed);
    const audioTrack = current().tracks.find(track => track.kind === 'audio')!;
    await press(audioTrack.name);
    await press(t('beat.ruler.right')); await press(t('beat.ruler.right'));
    await press(t('beat.snap.quarter'));
    await press(t('beat.library.open'));
    const intent = mockLibrarySheetProps.placement();
    const commit = mockLibrarySheetProps.onCommit;
    expect(intent).toEqual({ start: 960, trackId: audioTrack.id });

    await press(current().tracks[0].name);
    await press(t('beat.ruler.right'));
    expect(mockLibrarySheetProps.placement()).not.toEqual(intent);
    const asset = soundAsset(BEAT_SOUNDS[0], current().tempo.bpm);
    let committed = false;
    await act(async () => { committed = commit(asset, intent); });
    expect(committed).toBe(true);
    const affected = current().tracks.find(track => track.id === audioTrack.id)!;
    expect(affected.regions.some(region => region.start === 960 && current().assets?.[region.assetId!]?.name === asset.name)).toBe(true);
    expect(control(audioTrack.name).props.accessibilityState.selected).toBe(true);
    await press(t('beat.undo'));
    expect(same(current())).toEqual(same(before));
});
test('a deleted captured audio lane refuses library commit without retargeting, history, selection, or close', async () => {
    await open(mixed);
    const audioTrack = current().tracks.find(track => track.kind === 'audio')!;
    await press(audioTrack.name); await press(t('beat.library.open'));
    const intent = mockLibrarySheetProps.placement(), commit = mockLibrarySheetProps.onCommit;
    await act(async () => putBeat(removeTrack(current(), audioTrack.id)));
    const afterDelete = JSON.stringify(current());
    const selectedBefore = current().tracks.find(track => control(track.name)?.props.accessibilityState.selected)?.id;
    mockAnnounce.mockClear();
    let committed = true;
    await act(async () => { committed = commit(soundAsset(BEAT_SOUNDS[0], current().tempo.bpm), intent); });
    expect(committed).toBe(false);
    expect(JSON.stringify(current())).toBe(afterDelete);
    expect(current().tracks.find(track => control(track.name)?.props.accessibilityState.selected)?.id).toBe(selectedBefore);
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    expect(node('mock-beat-song-library-sheet')).toBeDefined();
    expect(mockAnnounce).not.toHaveBeenCalled();
});
test('deferred library commit rechecks a writable document that became read-only without an English route refusal', async () => {
    await open(mixed);
    await press(t('beat.library.open'));
    const commit = mockLibrarySheetProps.onCommit, intent = mockLibrarySheetProps.placement();
    await act(async () => putBeat({ ...current(), version: 5 }));
    expect(mockLibrarySheetProps.disabled).toBe(true);
    const readOnly = JSON.stringify(current());
    mockAnnounce.mockClear();
    let committed = true;
    await act(async () => { committed = commit(soundAsset(BEAT_SOUNDS[0], current().tempo.bpm), intent); });
    expect(committed).toBe(false); expect(JSON.stringify(current())).toBe(readOnly);
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    expect(mockAnnounce).not.toHaveBeenCalled();
});
test('max-track refusal leaves the library open without document or history mutation', async () => {
    await open(doc => { let next = doc; while (next.tracks.length < 16) next = addKitTrack(next); return next; });
    await press(t('beat.library.open'));
    const full = JSON.stringify(current());
    mockAnnounce.mockClear();
    let committed = true;
    await act(async () => { committed = mockLibrarySheetProps.onCommit(soundAsset(BEAT_SOUNDS[0], current().tempo.bpm), mockLibrarySheetProps.placement()); });
    expect(committed).toBe(false); expect(JSON.stringify(current())).toBe(full);
    expect(node('mock-beat-song-library-sheet')).toBeDefined();
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    expect(mockAnnounce).not.toHaveBeenCalled();
});
test('replacement and store-busy transitions silently refuse a deferred library commit', async () => {
    await open(mixed); await press(t('beat.library.open'));
    const commit = mockLibrarySheetProps.onCommit, intent = mockLibrarySheetProps.placement();
    const asset = soundAsset(BEAT_SOUNDS[0], current().tempo.bpm), before = JSON.stringify(current());
    let release!: () => void;
    await act(async () => { release = await beforeReplace(mockId); });
    mockAnnounce.mockClear();
    let committed = true;
    await act(async () => { committed = commit(asset, intent); });
    expect(committed).toBe(false); expect(JSON.stringify(current())).toBe(before); expect(mockAnnounce).not.toHaveBeenCalled();
    await act(async () => release());

    mockPutBeatBusy = true; mockAnnounce.mockClear();
    await act(async () => { committed = commit(asset, intent); });
    mockPutBeatBusy = false;
    expect(committed).toBe(false); expect(JSON.stringify(current())).toBe(before); expect(mockAnnounce).not.toHaveBeenCalled();
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});
test('recording lock and vanished document silently refuse a captured library commit', async () => {
    let recordingLocked = false;
    const original = recordingHook.useTakeRecording;
    let sourceController: ReturnType<typeof recordingHook.useTakeRecording>['controller'] | null = null;
    let wrappedController: ReturnType<typeof recordingHook.useTakeRecording>['controller'] | null = null;
    const hook = jest.spyOn(recordingHook, 'useTakeRecording').mockImplementation((...args) => {
        const result = original(...args);
        if (sourceController !== result.controller) {
            sourceController = result.controller;
            wrappedController = new Proxy(result.controller, { get(target, key, receiver) {
                if (key === 'locked') return () => recordingLocked;
                const value = Reflect.get(target, key, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            } });
        }
        return { ...result, controller: wrappedController! };
    });
    try {
        await open(mixed); await press(t('beat.library.open'));
        const commit = mockLibrarySheetProps.onCommit, intent = mockLibrarySheetProps.placement();
        const asset = soundAsset(BEAT_SOUNDS[0], current().tempo.bpm), before = JSON.stringify(current());
        recordingLocked = true; mockAnnounce.mockClear();
        let committed = true;
        await act(async () => { committed = commit(asset, intent); });
        expect(committed).toBe(false); expect(JSON.stringify(current())).toBe(before); expect(mockAnnounce).not.toHaveBeenCalled();
        recordingLocked = false;

        await act(async () => dropBeat(mockId));
        mockAnnounce.mockClear();
        await act(async () => { committed = commit(asset, intent); });
        expect(committed).toBe(false); expect(getBeat(mockId)).toBeUndefined(); expect(mockAnnounce).not.toHaveBeenCalled();
    } finally { hook.mockRestore(); }
});
test('Song starter Sounds use the snapped locator/audio lane at Add after editor placement drift and undo exactly once', async () => {
    const before = await open(mixed);
    await press(t('beatLabs.sounds'));
    expect(node('mock-beat-sounds-sheet')).toBeDefined();
    const addAfterDrift = mockSoundsSheetProps.onAdd;
    const audioTrack = current().tracks.find(track => track.kind === 'audio')!;
    await press(audioTrack.name);
    await press(t('beat.ruler.right')); await press(t('beat.ruler.right')); await press(t('beat.snap.quarter'));
    let committed = false;
    await act(async () => { committed = addAfterDrift(BEAT_SOUNDS[0]); });
    expect(committed).toBe(true);
    const affected = current().tracks.find(track => track.id === audioTrack.id)!;
    expect(affected.regions.some(region => region.start === 960 && current().assets?.[region.assetId!]?.source === 'sound')).toBe(true);
    expect(control(audioTrack.name).props.accessibilityState.selected).toBe(true);
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});
test('Song library dismissal restores trigger focus without exposing beat-maker controls', async () => {
    const resolve = jest.fn(() => 42), focus = jest.fn();
    restoreBeatLibraryTriggerFocus({} as ComponentRef<typeof RN.Pressable>, resolve, focus);
    expect(resolve).toHaveBeenCalledTimes(1); expect(focus).toHaveBeenCalledWith(42);
    await open();
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('beatLabs.sounds') && typeof (n.props.onClick ?? n.props.onPress) === 'function')).toHaveLength(1);
    await press(t('beat.library.open'));
    const dismiss = mockLibrarySheetProps.onDismiss;
    expect(typeof dismiss).toBe('function');
    await act(async () => mockLibrarySheetProps.onClose());
    expect(node('mock-beat-song-library-sheet')).toBeUndefined();
    expect(() => dismiss()).not.toThrow();

    expect(control(t('beat.view.pattern'))).toBeUndefined();
    expect(node('beat-arrangement')).toBeDefined();
});
test('first search selection queues reveal after selection and retries fresh geometry after content reflow', async () => {
    await open(searchManyDoc);
    expect(node('region-inspector')).toBeUndefined();
    const attempts: MeasureAndRevealLaneInput[] = [];
    mockMeasureAndRevealLane.mockImplementation(input => {
        attempts.push(input);
        if (attempts.length === 2) input.onReveal(900);
    });
    const scrollTo = (RN.ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;
    scrollTo.mockClear();
    await act(async () => field(t('beat.search.label')).props.onChangeText('drums search'));
    await pressNode('beat-search-result-search2');
    expect(node('region-inspector')).toBeDefined();
    expect(attempts).toHaveLength(1);

    await act(async () => node('beat-editor-workspace').props.onContentSizeChange(400, 2000));
    expect(attempts[0].isCurrent()).toBe(false);
    await act(async () => jest.runOnlyPendingTimers());
    expect(attempts).toHaveLength(2);
    expect(attempts[1].contentHeight).toBe(2000);
    expect(scrollTo).toHaveBeenCalledWith({ y: 900, animated: false });
});
test('observed scroll invalidates an in-flight reveal while matching programmatic scroll does not retry', async () => {
    await open(searchManyDoc);
    const attempts: MeasureAndRevealLaneInput[] = [];
    mockMeasureAndRevealLane.mockImplementation(input => {
        attempts.push(input);
        if (attempts.length === 2) input.onReveal(700);
    });
    const workspace = node('beat-editor-workspace');
    const scrollTo = (RN.ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;
    scrollTo.mockClear();
    await act(async () => field(t('beat.search.label')).props.onChangeText('drums search'));
    await pressNode('beat-search-result-search2');
    expect(attempts).toHaveLength(1);

    await act(async () => workspace.props.onScroll({ nativeEvent: { contentOffset: { y: 320 } } }));
    expect(attempts[0].isCurrent()).toBe(false);
    await act(async () => jest.runOnlyPendingTimers());
    expect(attempts).toHaveLength(2);
    expect(attempts[1].currentScrollY).toBe(320);
    expect(scrollTo).toHaveBeenCalledWith({ y: 700, animated: false });

    await act(async () => workspace.props.onScroll({ nativeEvent: { contentOffset: { y: 700 } } }));
    await act(async () => jest.runOnlyPendingTimers());
    expect(attempts).toHaveLength(2);
});
test('a second same-lane search choice supersedes the first pending reveal', async () => {
    await open(searchManyDoc);
    const attempts: MeasureAndRevealLaneInput[] = [];
    mockMeasureAndRevealLane.mockImplementation(input => { attempts.push(input); });
    const scrollTo = (RN.ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;
    await act(async () => field(t('beat.search.label')).props.onChangeText('drums search'));
    await pressNode('beat-search-result-search0');
    await pressNode('beat-search-result-search1');
    expect(attempts).toHaveLength(2);
    expect(attempts[0].lane).toBe(attempts[1].lane);
    expect(attempts[0].isCurrent()).toBe(false);
    expect(attempts[1].isCurrent()).toBe(true);
    scrollTo.mockClear();

    if (attempts[0].isCurrent()) attempts[0].onReveal(500);
    if (attempts[1].isCurrent()) attempts[1].onReveal(900);
    expect(scrollTo.mock.calls.filter(([value]) => value?.y !== undefined)).toEqual([
        [{ y: 900, animated: false }],
    ]);
});
test.each(['onScrollBeginDrag', 'onMomentumScrollBegin'] as const)('%s cancels pending lane measurement and its queued retry', async eventName => {
    await open(searchManyDoc);
    const attempts: MeasureAndRevealLaneInput[] = [];
    mockMeasureAndRevealLane.mockImplementation(input => { attempts.push(input); });
    const scrollTo = (RN.ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;
    await act(async () => field(t('beat.search.label')).props.onChangeText('drums search'));
    await pressNode('beat-search-result-search2');
    expect(attempts).toHaveLength(1);
    const workspace = node('beat-editor-workspace');
    await act(async () => workspace.props.onContentSizeChange(400, 2000));
    scrollTo.mockClear();

    await act(async () => workspace.props[eventName]());
    expect(attempts[0].isCurrent()).toBe(false);
    attempts[0].onReveal(800);
    await act(async () => jest.runOnlyPendingTimers());
    expect(attempts).toHaveLength(1);
    expect(scrollTo.mock.calls.some(([value]) => value?.y !== undefined)).toBe(false);
});
test('A6 ruler locator is view state; cycle toggle, endpoints and invalid cycle use apply', async () => {
    const before = await open();
    await press(t('beat.ruler.next')); await press(t('beat.ruler.previous')); await press(t('beat.ruler.end')); await press(t('beat.ruler.start'));
    await act(async () => node('ruler-position').props.onClick({ nativeEvent: { locationX: 24 } }));
    expect(same(current())).toEqual(same(before)); expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
    await press(t('beat.cycle.start')); expect(current().cycle.start).toBe(960);
    await press(t('beat.cycle.off')); expect(current().cycle.on).toBe(true);
    await press(t('beat.ruler.next')); await press(t('beat.cycle.end')); expect(current().cycle.end).toBe(4800);
    await press(t('beat.cycle.start'));
    expect(mockAnnounce).toHaveBeenCalledWith(t('beat.refused', { reason: 'The cycle needs a start before its end, on the step grid.' }));
    expect(current().cycle.start).toBe(960); await press(t('beat.undo')); expect(current().cycle.end).toBe(before.cycle.end);
});
test.each(['start', 'end'])('A6 cycle %s hold drag commits once and undoes', async edge => {
    const before = await open(); await drag(`cycle-${edge}`, 24);
    expect(current().cycle).toEqual({ ...before.cycle, [edge]: before.cycle[edge as 'start' | 'end'] + 960 });
    await press(t('beat.undo')); expect(current().cycle).toEqual(before.cycle);
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});
test.each(operations)('A7 screen reader %s uses the same web op', async (name, operation) => {
    const before = await open(d => moveRegion(addKitTrack(d, '808'), 'r1', 960, 't1')); await press(t('beat.ruler.next'));
    const props = node('region-r1').props;
    expect(props.accessibilityLabel).toBe(regionLabel(before, before.tracks[0], before.tracks[0].regions[0]));
    expect(props.accessibilityActions.some((action: { name: string }) => action.name === name)).toBe(true);
    await act(async () => props.onAccessibilityAction({ nativeEvent: { actionName: name } }));
    expect(same(current())).toEqual(same(operation(before)));
});
function mixed(doc: BeatDoc): BeatDoc {
    const audio = addAudioRegion(doc, { source: 'take', ref: 'n3-test', name: 'Voice', durationSec: 4, bpm: null, sourceChannels: 1, encodedBytes: 0 }, null, 0);
    const fixture = { ...audio, clips: { c1: { name: 'Keys', lengthTicks: 3840, notes: [] } }, tracks: [...audio.tracks, {
        id: 'tm', name: 'Keys track', kind: 'midi', instrument: { engine: 'voice', id: 'synth', preset: 'pad' }, gain: 1, pan: 0, mute: false, solo: false,
        regions: [{ id: 'rm', start: 0, length: 3840, clipId: 'c1', phaseTicks: 0 }],
    }] } as BeatDoc;
    expect(validateBeat(fixture).ok).toBe(true); return fixture;
}
test('A8 audio gain, fades and reverse edit validated audio regions and undo', async () => {
    await open(mixed); const id = current().tracks[1].regions[0].id; await choose(id);
    const audio = () => current().tracks[1].regions[0];
    await press(t('beat.value.increase', { field: t('beat.audio.gain') })); expect(audio().gainDb).toBe(1);
    await press(t('beat.value.increase', { field: t('beat.audio.fadeIn') })); expect(audio().fadeIn).toEqual({ startSec: 0, endSec: 0.05 });
    await press(t('beat.value.increase', { field: t('beat.audio.fadeOut') })); expect(audio().fadeOut).toEqual({ startBeforeEndSec: 0.05, endBeforeEndSec: 0 });
    await press(t('beat.audio.reverse')); expect(audio().reverse).toBe(true);
    await press(t('beat.undo')); expect(audio().reverse).toBe(false);
    expect(validateBeat(current()).ok).toBe(true);
});
test('A9b mixed mixer gain and mute work on every kind and kit controls only exist on drums', async () => {
    await open(mixed);
    await press(t('beat.track.controls'));
    for (let i = 0; i < 3; i++) {
        const track = t('beat.track', { n: i + 1 });
        const gain = root.container.queryAll(n => n.props.accessibilityLabel === t('beat.gain', { track }) && n.props.onAccessibilityAction)[0];
        await act(async () => gain.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
        expect(current().tracks[i].gain).toBe(0.9); await press(t('beat.mute', { track })); expect(current().tracks[i].mute).toBe(true);
        expect(root.container.queryAll(n => n.props.accessibilityLabel === t('beat.kit', { track })).length > 0).toBe(i === 0);
    }
    await press(t('beat.track.controls'));
    await press(current().tracks[1].name); expect(control(t('beat.region.add')).props.accessibilityState.disabled).toBe(true);
    await choose('rm'); expect(node('region-inspector')).toBeDefined(); expect(control(t('beat.audio.reverse'))).toBeUndefined();
});
test('A9b add region explicitly uses the changed active snap', async () => {
    await open(); await press(t('beat.ruler.right')); await press(t('beat.ruler.right')); // locator 480
    await press(t('beat.snap.quarter')); const before = current(); await press(t('beat.region.add'));
    expect(same(current())).toEqual(same(addRegion(before, 't1', 960, before.currentPattern)));
});

test('A7 narrow blocks keep musical width and 44pt hit areas; cycle handles remain labelled', async () => {
    await open(d => resizeRegion(d, 'r1', 240)); await choose();
    const region = node('region-r1').props, block = RN.StyleSheet.flatten(region.style);
    expect(block.width).toBe(6); expect(block.minHeight).toBeGreaterThanOrEqual(44);
    expect(block.width + region.hitSlop.left + region.hitSlop.right).toBeGreaterThanOrEqual(44);
    expect(node('r1-trim')).toBeUndefined(); expect(node('r1-resize')).toBeUndefined();
    for (const id of ['cycle-start', 'cycle-end']) {
        const handle = node(id).props, style = RN.StyleSheet.flatten(handle.style);
        expect(handle.accessibilityLabel).toBeTruthy(); expect(style.width).toBeGreaterThanOrEqual(24);
        expect(style.width + 2 * handle.hitSlop).toBeGreaterThanOrEqual(44);
        expect(style.height + 2 * handle.hitSlop).toBeGreaterThanOrEqual(44);
    }
});
test('measured lane heights and initial finger position determine the drop lane', async () => {
    await open(d => addKitTrack(d, '808'));
    const header = control(current().tracks[0].name);
    await act(async () => header.props.onLayout({ nativeEvent: { layout: { height: 140 } } }));
    const props = node('region-r1').props;
    const event = (dy: number) => ({ nativeEvent: { identifier: 1, pageX: 0, pageY: 10 + dy, locationY: 10 }, stopPropagation: jest.fn() });
    await act(async () => { props.onTouchStart(event(0)); jest.advanceTimersByTime(350); });
    await act(async () => props.onTouchMove(event(125)));
    expect(node('region-preview')).toBeDefined();
    await act(async () => props.onTouchEnd(event(125)));
    expect(current().tracks[0].regions.some(region => region.id === 'r1')).toBe(true);
    await drag('region-r1', 0, 140);
    expect(current().tracks[1].regions.some(region => region.id === 'r1')).toBe(true);
});
test('auto-scroll follows playback until a manual scroll and resets on the next run', async () => {
    await open();
    const scrollTo = (RN.ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;
    await act(async () => node('arrangement-scroll').props.onLayout({ nativeEvent: { layout: { width: 120 } } }));
    await press(t('beat.play'));
    const callback = () => (mockAudio.play.mock.calls as unknown as [unknown, (step: number) => void][]).at(-1)![1];
    await act(async () => callback()(64)); expect(scrollTo).toHaveBeenLastCalledWith({ x: 354, animated: false });
    await act(async () => node('arrangement-scroll').props.onScrollBeginDrag()); scrollTo.mockClear();
    await act(async () => callback()(0)); expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => node('arrangement-scroll').props.onLayout({ nativeEvent: { layout: { width: 120 } } }));
    await act(async () => callback()(48)); expect(scrollTo).not.toHaveBeenCalled();
    await press(t('beat.stop')); await press(t('beat.play')); scrollTo.mockClear();
    await act(async () => callback()(80)); expect(scrollTo).toHaveBeenLastCalledWith({ x: 450, animated: false });
});

test('N3-R1 touches over the label use block coordinates and cross the real lane boundary', async () => {
    const before = await open(d => addKitTrack(d, '808')); await choose();
    const block = node('region-r1'), label = node('region-label-r1');
    expect(label.props.pointerEvents).toBe('none');
    expect(block.props.pointerEvents).toBe('box-only');
    for (const id of ['r1-trim', 'r1-resize', 'cycle-start', 'cycle-end']) expect(node(id).props.pointerEvents).toBe('box-only');
    expect(node('cycle-band').props.pointerEvents).toBe('none');
    // Model native hit testing at the label: its local y=4 is 18 pt down the compact block
    // (12 pt padding + 2 pt border). A non-touchable label retargets to the block.
    const labelY = 4, blockY = 18, laneTop = 4, laneHeight = 64;
    const target = label.props.pointerEvents === 'none' ? block : label;
    const event = (dy: number) => ({ nativeEvent: { identifier: 1, target: target.props.testID,
        pageX: 100, pageY: laneTop + blockY + dy, locationY: (target === block ? blockY : labelY) + dy }, stopPropagation: jest.fn() });
    await act(async () => { block.props.onTouchStart(event(0)); jest.advanceTimersByTime(350); });
    // One point before the actual boundary still previews in the first lane.
    const boundary = laneHeight - laneTop - blockY;
    await act(async () => block.props.onTouchMove(event(boundary - 1)));
    const previews = (trackId: string) => node(`track-lane-${trackId}`).queryAll(n => n.props.testID === 'region-preview');
    expect(previews(before.tracks[0].id)).toHaveLength(1); expect(previews(before.tracks[1].id)).toHaveLength(0);
    await act(async () => block.props.onTouchMove(event(boundary)));
    expect(previews(before.tracks[0].id)).toHaveLength(0); expect(previews(before.tracks[1].id)).toHaveLength(1);
    await act(async () => block.props.onTouchEnd(event(boundary)));
    expect(same(current())).toEqual(same(moveRegion(before, 'r1', 0, before.tracks[1].id)));
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
});

test('N3-R2 a new music edit stays in Song with no beat-maker Pattern switch', async () => {
    const doc = await open();
    expect(doc.view).toBe('song'); expect(current().view).toBe('song');
    expect(node('beat-arrangement')).toBeDefined();
    expect(control(t('beat.view.pattern'))).toBeUndefined();
    expect(control(t('beat.view.song'))).toBeUndefined();
    expect(control(t('beat.pad.hit', { pad: t('beat.pad.kick') }))).toBeUndefined();
});

test.each(['fadeIn', 'fadeOut'] as const)('N3-R3 partial %s keeps its anchor through 50 ms steps and minimum clamping', async which => {
    const initial = { fadeIn: { startSec: 0.2, endSec: 0.225 }, fadeOut: { startBeforeEndSec: 0.225, endBeforeEndSec: 0.2 } };
    const before = await open(d => { const doc = mixed(d); return setAudioRegion(doc, doc.tracks[1].regions[0].id, initial); });
    const id = before.tracks[1].regions[0].id, field = t(`beat.audio.${which}`);
    await choose(id);
    expect(root.container.queryAll(n => n.children.includes(t('beat.audio.partialFade', { field }))).length).toBeGreaterThan(0);
    await press(t('beat.value.increase', { field }));
    const increased = which === 'fadeIn' ? { startSec: 0.2, endSec: 0.275 } : { startBeforeEndSec: 0.275, endBeforeEndSec: 0.2 };
    expect(same(current())).toEqual(same(setAudioRegion(before, id, { [which]: increased })));
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
    await press(t('beat.value.decrease', { field }));
    const clamped = which === 'fadeIn' ? { startSec: 0.2, endSec: 0.201 } : { startBeforeEndSec: 0.201, endBeforeEndSec: 0.2 };
    expect(same(current())).toEqual(same(setAudioRegion(before, id, { [which]: clamped })));
    expect(control(t('beat.value.decrease', { field })).props.accessibilityState.disabled).toBe(true);
    expect(validateBeat(current()).ok).toBe(true);
});

test.each(['fadeIn', 'fadeOut'] as const)('N3-R3 partial %s with a negative anchor stays partial at zero; plain fades become null', async which => {
    const partial = which === 'fadeIn' ? { startSec: -0.2, endSec: 0.05 } : { startBeforeEndSec: 0.05, endBeforeEndSec: -0.2 };
    await open(d => { const doc = mixed(d); return setAudioRegion(doc, doc.tracks[1].regions[0].id, { [which]: partial }); });
    const id = current().tracks[1].regions[0].id, field = t(`beat.audio.${which}`);
    await choose(id); await press(t('beat.value.decrease', { field }));
    expect(current().tracks[1].regions[0][which]).toEqual(which === 'fadeIn' ? { startSec: -0.2, endSec: 0 } : { startBeforeEndSec: 0, endBeforeEndSec: -0.2 });
    expect(validateBeat(current()).ok).toBe(true);
    const plain = which === 'fadeIn' ? { startSec: 0, endSec: 0.05 } : { startBeforeEndSec: 0.05, endBeforeEndSec: 0 };
    await act(async () => putBeat(setAudioRegion(current(), id, { [which]: plain })));
    await press(t('beat.value.decrease', { field })); expect(current().tracks[1].regions[0][which]).toBeNull();
});

test('N3-R4 a selected narrow region stays movable with one undoable move and inspector trimming', async () => {
    const before = await open(d => resizeRegion(d, 'r1', 240)); await choose();
    expect(node('region-r1').props.accessibilityState.selected).toBe(true);
    expect(node('r1-trim')).toBeUndefined(); expect(node('r1-resize')).toBeUndefined();
    for (const action of ['shorter', 'longer', 'trim', 'extend']) {
        expect(control(t(`beat.region.${action}`))).toBeDefined();
        expect(node('region-r1').props.accessibilityActions.some((item: { name: string }) => item.name === action)).toBe(true);
    }
    await drag('region-r1', 24);
    expect(same(current())).toEqual(same(moveRegion(before, 'r1', 960, 't1')));
    await press(t('beat.undo')); expect(same(current())).toEqual(same(before));
    expect(control(t('beat.undo')).props.accessibilityState.disabled).toBe(true);
});

test('N3-R4 handles appear at 88 pt and the resize target is centred on the drawn right edge', async () => {
    await open(d => resizeRegion(d, 'r1', 2640)); await choose(); // 66 pt at the default zoom.
    expect(node('r1-trim')).toBeUndefined(); expect(node('r1-resize')).toBeUndefined();
    await press(t('beat.zoom.in')); // 88 pt at 128 pt/bar.
    const block = RN.StyleSheet.flatten(node('region-r1').props.style);
    const frame = RN.StyleSheet.flatten(node('region-frame-r1').props.style);
    const hit = RN.StyleSheet.flatten(node('r1-resize-hit').props.style);
    expect(block.width).toBe(88); expect(hit.left + hit.width / 2).toBe(block.width);
    expect(frame.width).toBeGreaterThanOrEqual(hit.left + hit.width);
    for (const id of ['r1-trim', 'r1-resize']) {
        const handle = node(id).props, visual = RN.StyleSheet.flatten(handle.style);
        expect(handle.accessibilityLabel).toBeTruthy(); expect(visual.width).toBe(24);
        expect(visual.width + handle.hitSlop * 2).toBe(44);
    }
});
test('cycle and trim handles speak where their edge is', async () => {
    await open(); await choose();
    const doc = current(), region = doc.tracks[0].regions[0];
    expect(node('cycle-start').props.accessibilityValue).toEqual({ text: position(doc.cycle.start) });
    expect(node('cycle-end').props.accessibilityValue).toEqual({ text: position(doc.cycle.end) });
    expect(node('r1-trim').props.accessibilityValue).toEqual({ text: position(region.start) });
    expect(node('r1-resize').props.accessibilityValue).toEqual({ text: position(region.start + region.length) });
});
test('tapping another region while holding a resize handle keeps the selection and commits the resize once', async () => {
    await open(d => addRegion(d, 't1', 8 * 3840, d.currentPattern)); await choose('r1');
    const before = current().tracks[0].regions.find(r => r.id === 'r1')!;
    const handle = node('r1-resize').props, second = { nativeEvent: { identifier: 2, pageX: 0, pageY: 0 }, stopPropagation: jest.fn() };
    await act(async () => { handle.onTouchStart(touch()); jest.advanceTimersByTime(350); });
    await act(async () => { const r2 = node('region-r2').props; r2.onTouchStart(second); r2.onTouchEnd(second); });
    expect(node('r1-resize')).toBeDefined(); expect(node('arrangement-scroll').props.scrollEnabled).toBe(false);
    await act(async () => node('r1-resize').props.onTouchMove(touch(96)));
    await act(async () => node('r1-resize').props.onTouchEnd(touch(96)));
    expect(current().tracks[0].regions.find(r => r.id === 'r1')!.length).toBe(before.length + 3840);
    expect(node('arrangement-scroll').props.scrollEnabled).toBe(true);
});
