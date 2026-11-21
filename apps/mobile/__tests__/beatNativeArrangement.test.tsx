import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import BeatEditor from '../src/app/(app)/beats/[id]';
import { t } from '../src/lib/i18n';
import { beatStore, newBeat, resetBeats, getBeat, putBeat } from '../src/lib/beatNative/store';
import { addAudioRegion, addKitTrack, addRegion, copyRegion, deleteRegion, duplicateRegion, moveRegion, resizeRegion, selectPattern, setCycle, setAudioRegion, setRegionPattern, setView, splitRegion, trimRegionStart, validateBeat, type BeatDoc, type Edit } from '../src/lib/beatNative/doc';
import { position, regionLabel } from '../src/lib/beatNative/regionActions';

jest.mock('../src/lib/beatNative/persist', () => ({ ...jest.requireActual('../src/lib/beatNative/persist'), documentFiles: () => ({ read: async () => null, write: async () => {}, remove: async () => {}, list: async () => [] }) }));
jest.mock('../src/components/beats/BeatSaveControls', () => ({ BeatSaveControls: () => null }));
jest.mock('../src/components/beats/ai/BeatAiPanel', () => ({ BeatAiPanel: () => null }));
jest.mock('../src/components/beats/BeatLabsBar', () => ({ BeatLabsBar: () => null }));
jest.mock('../src/components/beats/BeatExportSheet', () => ({ BeatExportSheet: () => null }));
jest.mock('../src/lib/beatNative/useLocalBeatLifecycle', () => ({ useLocalBeatLifecycle: () => {} }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
const mockAnnounce = jest.fn();
jest.mock('../src/lib/useAnnouncement', () => ({ ...jest.requireActual('../src/lib/useAnnouncement'), useAnnouncement: (value: string) => { if (value) mockAnnounce(value); } }));
const mockAudio = { play: jest.fn(async () => {}), stop: jest.fn(), close: jest.fn(async () => {}), hitPad: jest.fn(), setTrackMix: jest.fn() };
jest.mock('../src/lib/beatNative/audio', () => ({ createBeatAudio: () => mockAudio }));
let mockId = '';
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useLocalSearchParams: () => ({ id: mockId }) }));
void [RN.View, RN.ScrollView, RN.Pressable, RN.Text];
let root: Root;
const current = () => getBeat(mockId)!;
const node = (id: string) => root.container.queryAll(n => n.props.testID === id)[0];
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
const press = async (label: string) => {
    const button = control(label); if (!button) throw new Error(`Missing ${label}`);
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
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); resetBeats(); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); resetBeats(); jest.useRealTimers(); });

test('A1 view switch is saved and one Undo restores pattern view', async () => {
    await open(d => setView(d, 'pattern'));
    await act(async () => beatStore.flushBeats()); expect(beatStore.saveState(mockId)).toBe('saved');
    await press(t('beat.view.song'));
    expect(current().view).toBe('song'); expect(beatStore.saveState(mockId)).toBe('saving'); expect(node('beat-arrangement')).toBeDefined();
    await press(t('beat.undo')); expect(current().view).toBe('pattern'); expect(node('beat-arrangement')).toBeUndefined();
    await press(t('beat.redo')); expect(current().view).toBe('song');
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
    expect(current().currentPattern).toBe('C'); await press(t('beat.undo')); expect(current().currentPattern).toBe('C');
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
    for (let i = 0; i < 3; i++) {
        const track = t('beat.track', { n: i + 1 });
        const gain = root.container.queryAll(n => n.props.accessibilityLabel === t('beat.gain', { track }) && n.props.onAccessibilityAction)[0];
        await act(async () => gain.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
        expect(current().tracks[i].gain).toBe(0.9); await press(t('beat.mute', { track })); expect(current().tracks[i].mute).toBe(true);
        expect(root.container.queryAll(n => n.props.accessibilityLabel === t('beat.kit', { track })).length > 0).toBe(i === 0);
    }
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
test('mixed documents choose the first drum kit for pad preview even when audio is first', async () => {
    await open(d => { const doc = mixed(d); return setView({ ...doc, tracks: [doc.tracks[1], doc.tracks[2], doc.tracks[0]] }, 'pattern'); });
    await press(t('beat.pad.hit', { pad: t('beat.pad.snare') }));
    expect(mockAudio.hitPad).toHaveBeenCalledWith('snare', '808');
});
test('auto-scroll follows playback until a manual scroll, including switching views during the run', async () => {
    await open();
    const scrollTo = (RN.ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype.scrollTo;
    await act(async () => node('arrangement-scroll').props.onLayout({ nativeEvent: { layout: { width: 120 } } }));
    await press(t('beat.play'));
    const callback = () => (mockAudio.play.mock.calls as unknown as [unknown, (step: number) => void][]).at(-1)![1];
    await act(async () => callback()(64)); expect(scrollTo).toHaveBeenLastCalledWith({ x: 354, animated: false });
    await act(async () => node('arrangement-scroll').props.onScrollBeginDrag()); scrollTo.mockClear();
    await act(async () => callback()(0)); expect(scrollTo).not.toHaveBeenCalled();
    await press(t('beat.view.pattern')); await press(t('beat.view.song'));
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
    // Model native hit testing at the label: its local y=4 is 30 pt down the block
    // (24 pt padding + 2 pt border). A non-touchable label retargets to the block.
    const labelY = 4, blockY = 30, laneTop = 4, laneHeight = 96;
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

test('N3-R2 a new phone beat opens in Song with arrangement and a reachable Pattern switch', async () => {
    const doc = await open();
    expect(doc.view).toBe('song'); expect(current().view).toBe('song');
    expect(node('beat-arrangement')).toBeDefined();
    expect(control(t('beat.view.pattern'))).toBeDefined();
    expect(control(t('beat.view.song')).props.accessibilityState.selected).toBe(true);
    await press(t('beat.view.pattern')); expect(node('beat-arrangement')).toBeUndefined();
    expect(control(t('beat.pad.hit', { pad: t('beat.pad.kick') }))).toBeDefined();
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
