import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import BeatPianoScreen from '../src/app/(app)/beats/piano/[id]';
import { BeatInstrumentsSection } from '../src/components/beats/BeatInstrumentsSection';
import { useBeatEdit } from '../src/lib/beatNative/useBeatEdit';
import { addInstrumentTrack, addNote, asMidiDoc, midiRegions, noteLabel } from '../src/lib/beatNative/midi';
import { beatStore, getBeat, newBeat, putBeat, resetBeats } from '../src/lib/beatNative/store';
import { t } from '../src/lib/i18n';
import { Button } from '../src/components/ui';
import { noteLengthUnits, notePosition } from '../src/lib/beatNative/rollGeometry';
import { validateBeat } from '../src/lib/beatNative/doc';

jest.mock('../src/lib/beatNative/persist', () => ({ ...jest.requireActual('../src/lib/beatNative/persist'), documentFiles: () => ({ read: async () => null, write: async () => {}, remove: async () => {}, list: async () => [] }) }));
let mockParams = { id: '', region: '' };
const mockAudio = { play: jest.fn(async () => {}), stop: jest.fn(), isPlaying: jest.fn(() => true), hitPad: jest.fn(), setTrackMix: jest.fn(), close: jest.fn(async () => {}), noteOn: jest.fn(async () => {}), noteOff: jest.fn(), releaseKeys: jest.fn(), audition: jest.fn(async () => {}) };
jest.mock('../src/lib/beatNative/audio', () => ({ createBeatAudio: () => mockAudio }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: unknown }) => children, Stack: { Screen: () => null }, router: { push: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
void [RN.View, RN.ScrollView, RN.Pressable, RN.Text, RN.Modal, RN.TextInput];
let root: Root;
const nodes = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label);
const press = async (label: string) => {
    const n = nodes(label).find(n => typeof (n.props.onClick ?? n.props.onPress) === 'function');
    if (!n) throw new Error(`Missing ${label}`);
    await act(async () => { (n.props.onClick ?? n.props.onPress)({ nativeEvent: {} }); });
};
const notes = () => midiRegions(getBeat(mockParams.id)!)[0].clip.notes;
const labelFor = (index = 0) => { const n = notes()[index]; return t('beatPiano.note', { note: noteLabel(n[2]), ...notePosition(n[0]), length: noteLengthUnits(n[1]), velocity: n[3] }); };
async function open(withNote = false) {
    let doc = newBeat('Piano'); doc = addInstrumentTrack(doc, { engine: 'voice', id: 'piano', preset: 'grand' });
    const region = midiRegions(doc)[0].region;
    if (withNote) doc = addNote(doc, region.clipId, [0, 240, 60, 100]);
    putBeat(doc); mockParams = { id: doc.id, region: region.id };
    await act(async () => root.render(<BeatPianoScreen />));
    return doc;
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); resetBeats(); jest.clearAllMocks(); jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() })); });
afterEach(async () => { await act(async () => root.unmount()); resetBeats(); jest.restoreAllMocks(); });

test('cursor adds a note; accessible selection and actions edit through store and undo', async () => {
    await open(); await press(t('beatPiano.toggle'));
    expect(notes()).toEqual([[0, 240, 60, 100]]);
    await press(labelFor()); await press(t('beatPiano.right'));
    expect(notes()[0][0]).toBe(240);
    await press(t('beatPiano.up')); expect(notes()[0][2]).toBe(61);
    await press(t('beat.undo')); expect(notes()[0][2]).toBe(60);
    await press(t('beat.undo')); expect(notes()[0][0]).toBe(0);
    await press(t('beat.redo')); expect(notes()[0][0]).toBe(240);
    expect(validateBeat(getBeat(mockParams.id)).ok).toBe(true);
});
test('selected note can be resized, adjusted, quantised, deleted and undone', async () => {
    await open(true); await press(labelFor()); await press(t('beatPiano.longer'));
    expect(notes()[0][1]).toBe(480);
    await press(t('beatPiano.velocityUp')); expect(notes()[0][3]).toBe(116);
    await press(t('beatPiano.quantise')); expect(notes()[0][1]).toBe(480);
    await press(t('beatPiano.delete')); expect(notes()).toEqual([]);
    await press(t('beat.undo')); expect(notes()[0][3]).toBe(116);
});
test('cursor last cell clamps note length and is reclamped when the clip shortens', async () => {
    await open();
    for (let i = 0; i < 16; i++) await press(t('beatPiano.cursorRight'));
    await press(t('beatPiano.toggle')); expect(notes()).toEqual([[3810, 30, 60, 100]]);
    const field = nodes(t('beatPiano.bars')).find(n => n.props.onChangeText);
    expect(field).toBeDefined();
    await act(async () => { field!.props.onChangeText('0.25'); });
    await act(async () => { nodes(t('beatPiano.bars')).find(n => n.props.onBlur)!.props.onBlur(); });
    expect(notes()).toEqual([]);
    await press(t('beatPiano.toggle')); expect(notes()).toEqual([[930, 30, 60, 100]]);
});
test('make unique and clip length each undo in one step', async () => {
    await open(true); const old = midiRegions(getBeat(mockParams.id)!)[0].region.clipId;
    await press(t('beatPiano.unique')); expect(midiRegions(getBeat(mockParams.id)!)[0].region.clipId).not.toBe(old);
    await press(t('beat.undo')); expect(midiRegions(getBeat(mockParams.id)!)[0].region.clipId).toBe(old);
    const field = nodes(t('beatPiano.bars')).find(n => n.props.onChangeText)!;
    await act(async () => field.props.onChangeText('2.5'));
    const updated = nodes(t('beatPiano.bars')).find(n => n.props.onSubmitEditing)!;
    await act(async () => { updated.props.onSubmitEditing(); updated.props.onBlur(); });
    expect(asMidiDoc(getBeat(mockParams.id)!).clips[old].lengthTicks).toBe(9600);
    await press(t('beat.undo')); expect(asMidiDoc(getBeat(mockParams.id)!).clips[old].lengthTicks).toBe(3840);
});
test('keyboard press and release, playback, background cleanup', async () => {
    await open();
    const key = nodes(t('beatPiano.keys.play', { note: 'C4' })).find(n => n.props.onResponderGrant)!;
    const event = { persist() {}, currentTarget: 1, nativeEvent: { pageX: 0, pageY: 0, locationX: 0, locationY: 0 } };
    expect(key).toBeDefined();
    await act(async () => { key.props.onResponderGrant(event); });
    expect(mockAudio.noteOn).toHaveBeenCalledWith('touch:60', expect.objectContaining({ instrument: { engine: 'voice', id: 'piano', preset: 'grand' } }), 60, 100);
    await act(async () => { key.props.onResponderRelease(event); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    expect(mockAudio.noteOff).toHaveBeenCalledWith('touch:60');
    await press(t('beat.play')); expect(mockAudio.play).toHaveBeenCalled();
    await press(t('beat.stop')); expect(mockAudio.stop).toHaveBeenCalled();
    const listeners = jest.mocked(RN.AppState.addEventListener).mock.calls;
    await act(async () => { listeners.forEach(([, fn]) => fn('background')); });
    expect(mockAudio.releaseKeys).toHaveBeenCalled(); expect(mockAudio.close).toHaveBeenCalled();
});
function LibraryHarness({ id }: { id: string }) {
    const edit = useBeatEdit(id);
    return <><BeatInstrumentsSection doc={edit.doc!} apply={edit.apply} audio={() => mockAudio} onOpen={() => {}} /><Button label={t('beat.undo')} onPress={edit.undo} /></>;
}
test('library audition and add use shared voices and a single undoable store edit', async () => {
    const doc = newBeat('Library'); await act(async () => root.render(<LibraryHarness id={doc.id} />));
    await press(t('beatPiano.library.add')); await press(t('beatPiano.library.audition', { name: 'Grand piano' }));
    expect(mockAudio.audition).toHaveBeenCalledWith({ engine: 'voice', id: 'piano', preset: 'grand' });
    await press(t('beatPiano.library.addNamed', { name: 'Grand piano' }));
    expect(midiRegions(getBeat(doc.id)!)).toHaveLength(1); expect(beatStore.saveState(doc.id)).toBe('saving');
    await press(t('beat.undo')); expect(midiRegions(getBeat(doc.id)!)).toHaveLength(0);
});
test('missing clip has a back action', async () => {
    mockParams = { id: 'missing', region: 'missing' };
    await act(async () => root.render(<BeatPianoScreen />));
    expect(root.container.queryAll(n => n.children.includes(t('beatPiano.missing'))).length).toBeGreaterThan(0);
});

test('keyboard octave and velocity controls stop at their limits', async () => {
    await open();
    for (let i = 0; i < 4; i++) await press(t('beatPiano.keys.octaveDown'));
    expect(nodes(t('beatPiano.keys.play', { note: 'C1' })).length).toBeGreaterThan(0);
    expect(nodes(t('beatPiano.keys.octaveDown')).some(n => n.props.accessibilityState?.disabled)).toBe(true);
    for (let i = 0; i < 6; i++) await press(t('beatPiano.keys.octaveUp'));
    expect(nodes(t('beatPiano.keys.play', { note: 'C6' })).length).toBeGreaterThan(0);
    expect(nodes(t('beatPiano.keys.octaveUp')).some(n => n.props.accessibilityState?.disabled)).toBe(true);
    for (let i = 0; i < 9; i++) await press(t('beatPiano.keys.velocityDown'));
    expect(root.container.queryAll(n => n.children.includes(t('beatPiano.keys.velocity', { n: 1 }))).length).toBeGreaterThan(0);
    for (let i = 0; i < 9; i++) await press(t('beatPiano.keys.velocityUp'));
    expect(root.container.queryAll(n => n.children.includes(t('beatPiano.keys.velocity', { n: 127 }))).length).toBeGreaterThan(0);
    await press(t('beatPiano.off'));
    expect(nodes(t('beatPiano.quantise')).some(n => n.props.accessibilityState?.disabled)).toBe(true);
});


test('moving a selected subset preserves other selected notes; moving an unselected note leaves selection alone', async () => {
    await open(true);
    await act(async () => {
        const doc = getBeat(mockParams.id)!, clipId = midiRegions(doc)[0].region.clipId;
        putBeat(addNote(addNote(doc, clipId, [240, 240, 64, 100]), clipId, [480, 240, 67, 100]));
    });
    await press(labelFor(0)); await press(labelFor(1));
    const increment = async (index: number) => {
        const note = nodes(labelFor(index)).find(n => n.props.onAccessibilityAction)!;
        await act(async () => note.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    };
    const isSelected = (index: number) => nodes(labelFor(index)).some(n => n.props.accessibilityState?.selected);
    await increment(0);
    expect(notes().map(n => n[2])).toEqual([61, 64, 67]);
    expect([0, 1, 2].map(isSelected)).toEqual([true, true, false]);
    await increment(2);
    expect(notes().map(n => n[2])).toEqual([61, 64, 68]);
    expect([0, 1, 2].map(isSelected)).toEqual([true, true, false]);
    await press(t('beatPiano.right'));
    expect(notes().map(n => [n[0], n[2]])).toEqual([[240, 61], [480, 64], [480, 68]]);
});
test('selected-note and keyboard octave/velocity controls have distinct names and effects', async () => {
    await open(true); await press(labelFor());
    for (const [selected, keyboard] of [
        ['beatPiano.selected.octaveDown', 'beatPiano.keys.octaveDown'],
        ['beatPiano.selected.octaveUp', 'beatPiano.keys.octaveUp'],
        ['beatPiano.velocityDown', 'beatPiano.keys.velocityDown'],
        ['beatPiano.velocityUp', 'beatPiano.keys.velocityUp'],
    ]) { expect(t(selected)).not.toBe(t(keyboard)); expect(nodes(t(selected)).length).toBeGreaterThan(0); expect(nodes(t(keyboard)).length).toBeGreaterThan(0); }
    await press(t('beatPiano.keys.octaveDown')); expect(notes()[0][2]).toBe(60);
    await press(t('beatPiano.selected.octaveDown')); expect(notes()[0][2]).toBe(48);
    await press(t('beatPiano.keys.velocityDown')); expect(notes()[0][3]).toBe(100);
    await press(t('beatPiano.velocityDown')); expect(notes()[0][3]).toBe(84);
});
