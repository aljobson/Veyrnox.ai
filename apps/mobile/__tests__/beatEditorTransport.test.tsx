import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatEditorTransport } from '../src/components/beats/BeatEditorTransport';

let mockDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
let mockBottomInset = 34;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ default: () => mockDimensions }));
jest.mock('react-native-safe-area-context', () => ({
    SafeAreaView: ({ children, edges, style, ...props }: any) => {
        const React = jest.requireActual('react');
        const Native = jest.requireActual('react-native');
        return React.createElement(Native.View, { ...props, edges, style: [style, { paddingBottom: edges?.includes('bottom') ? mockBottomInset : 0 }] }, children);
    },
}));
void [RN.View, RN.Text, RN.Pressable];

let root: Root;
const props = { playing: false, starting: false, locked: false, canUndo: true, canRedo: true,
    pattern: 'A' as const, patternDisabled: false, onPattern: jest.fn(), onPatternControls: jest.fn(),
    onUndo: jest.fn(), onRedo: jest.fn(), onPlay: jest.fn(), onMixer: jest.fn() };
const render = async () => { await act(async () => root.render(<BeatEditorTransport {...props} />)); };

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
    mockBottomInset = 34;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('large text uses a bounded horizontal toolbar with one rendered primary action', async () => {
    mockDimensions = { ...mockDimensions, width: 390, height: 667, fontScale: 3.12 };
    await render();
    const scroller = root.container.queryAll(n => n.props.testID === 'beat-editor-transport-controls-accessible')[0];
    expect(scroller.props.horizontal).toBe(true);
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-status')).toHaveLength(0);
    for (const id of ['beat-editor-pattern-action', 'beat-editor-history-controls', 'beat-editor-playback-controls']) {
        const group = root.container.queryAll(n => n.props.testID === id)[0];
        expect(RN.StyleSheet.flatten(group.props.style)).toMatchObject({ flex: 0, width: 'auto' });
    }
    const style = (id: string) => RN.StyleSheet.flatten(root.container.queryAll(n => n.props.testID === id && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0].props.style);
    const primary = style('beat-editor-play').backgroundColor;
    for (const id of ['beat-editor-pattern-controls', 'beat-editor-undo', 'beat-editor-redo', 'beat-editor-mixer']) expect(style(id).backgroundColor).not.toBe(primary);
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-pattern-selector')).toHaveLength(1);
});

test('patterns are directly reachable, selected without colour, and locked with the controls entry', async () => {
    await render();
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-controls-compact' && n.props.horizontal)).toHaveLength(0);
    const selected = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === 'Pattern A')[0];
    expect(selected.props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    expect(selected.queryAll(n => RN.StyleSheet.flatten(n.props.style)?.borderWidth === 2)).toHaveLength(1);
    const target = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === 'Pattern B')[0];
    await act(async () => (target.props.onClick ?? target.props.onPress)({ nativeEvent: {} }));
    expect(props.onPattern).toHaveBeenCalledWith('B');
    await act(async () => root.render(<BeatEditorTransport {...props} patternDisabled />));
    const locked = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === 'Pattern B')[0];
    expect(locked.props.accessibilityState.disabled).toBe(true);
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-pattern-controls' && n.props.accessibilityState?.disabled)).toHaveLength(1);
});

test.each([360, 390, 719])('compact width %ipt keeps every labelled 44pt action in the fixed row', async width => {
    mockDimensions = { ...mockDimensions, width };
    await render();
    const controls = root.container.queryAll(n => n.props.testID === 'beat-editor-transport-controls-compact')[0];
    expect(controls.props.horizontal).toBeUndefined();
    for (const id of ['beat-editor-pattern-controls', 'beat-editor-undo', 'beat-editor-redo', 'beat-editor-play', 'beat-editor-mixer']) {
        const action = controls.queryAll(n => n.props.testID === id && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
        const style = RN.StyleSheet.flatten(action.props.style);
        expect(action.props.accessibilityLabel).toBeTruthy();
        expect(style.minWidth).toBeGreaterThanOrEqual(44);
        expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
});

test('regular width uses the row layout and protects landscape sides plus the bottom safe-area edge', async () => {
    mockDimensions = { ...mockDimensions, width: 1024 };
    await render();
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-controls-regular')).toHaveLength(1);
    const transport = root.container.queryAll(n => n.props.testID === 'beat-editor-transport')[0];
    expect(transport.props.edges).toEqual(['left', 'right', 'bottom']);
    expect(RN.StyleSheet.flatten(transport.props.style).paddingBottom).toBe(34);
});

test('phone landscape stays compact and MIDI stop is a stable labelled control outside the scroller', async () => {
    mockDimensions = { ...mockDimensions, width: 844, height: 390, fontScale: 3.12 };
    const onMidiRecord = jest.fn();
    await act(async () => root.render(<BeatEditorTransport {...props} midiRecordPhase="recording" onMidiRecord={onMidiRecord} />));
    const scroller = root.container.queryAll(n => n.props.testID === 'beat-editor-transport-controls-accessible')[0];
    expect(scroller.queryAll(n => n.props.testID === 'beat-midi-record-control')).toHaveLength(0);
    const control = root.container.queryAll(n => n.props.testID === 'beat-midi-record-control' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    expect(control.props.accessibilityLabel).toBeTruthy();
    expect(control.props.accessibilityState).toMatchObject({ disabled: false, busy: false });
    expect(RN.StyleSheet.flatten(control.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await act(async () => root.render(<BeatEditorTransport {...props} midiRecordPhase="finishing" midiRecordDisabled onMidiRecord={onMidiRecord} />));
    const finishing = root.container.queryAll(n => n.props.testID === 'beat-midi-record-control' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    expect(finishing.props.accessibilityState).toMatchObject({ disabled: false, busy: true });
});

test('recovery lock disables a new MIDI take and the non-live mixer entry semantically', async () => {
    const onMidiRecord = jest.fn(), onMixer = jest.fn();
    await act(async () => root.render(<BeatEditorTransport {...props} midiRecordPhase="idle" midiRecordDisabled
        mixerDisabled onMidiRecord={onMidiRecord} onMixer={onMixer} />));
    const record = root.container.queryAll(n => n.props.testID === 'beat-midi-record-control' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    const mixer = root.container.queryAll(n => n.props.testID === 'beat-editor-mixer' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    expect(record.props.accessibilityState.disabled).toBe(true);
    expect(mixer.props.accessibilityState.disabled).toBe(true);
});
