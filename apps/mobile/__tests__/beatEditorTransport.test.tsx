import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatEditorTransport } from '../src/components/beats/BeatEditorTransport';
import { t } from '../src/lib/i18n';

let mockDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
let mockBottomInset = 34;
let keyboardCallbacks: Record<string, (event?: any) => void> = {};
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ default: () => mockDimensions }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: mockBottomInset, left: 0 }),
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
    keyboardCallbacks = {};
    jest.spyOn(RN.Keyboard, 'addListener').mockImplementation(((event: string, callback: (event?: any) => void) => {
        keyboardCallbacks[event] = callback;
        return { remove: jest.fn() };
    }) as typeof RN.Keyboard.addListener);
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });

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

test('phone transport keeps MIDI record as a labelled icon in the main action row', async () => {
    const onMidiRecord = jest.fn();
    await act(async () => root.render(<BeatEditorTransport {...props} midiRecordPhase="idle" onMidiRecord={onMidiRecord} />));
    const controls = root.container.queryAll(n => n.props.testID === 'beat-editor-transport-controls-compact')[0];
    const record = controls.queryAll(n => n.props.testID === 'beat-midi-record-control' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    expect(record.props.accessibilityLabel).toBeTruthy();
    expect(RN.StyleSheet.flatten(record.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
    expect(root.container.queryAll(n => n.props.testID === 'beat-midi-record-row')).toHaveLength(0);
});

test('phone transport exposes add and export as labelled icon actions', async () => {
    const onAdd = jest.fn(), onExport = jest.fn();
    await act(async () => root.render(<BeatEditorTransport {...props} showPatterns={false} onAdd={onAdd} onExport={onExport} />));
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-pattern-selector')).toHaveLength(0);
    for (const [id, action] of [['beat-editor-add-track', onAdd], ['beat-editor-export', onExport]] as const) {
        const button = root.container.queryAll(n => n.props.testID === id && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
        expect(button.props.accessibilityLabel).toBeTruthy();
        expect(RN.StyleSheet.flatten(button.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
        await act(async () => (button.props.onClick ?? button.props.onPress)({ nativeEvent: {} }));
        expect(action).toHaveBeenCalledTimes(1);
    }
});

test('focused music dock exposes compact labelled tools without history chrome', async () => {
    const onAdd = jest.fn(), onAi = jest.fn(), onLibrary = jest.fn();
    await act(async () => root.render(<BeatEditorTransport {...props} showPatterns={false} showHistory={false} onAdd={onAdd} onAi={onAi} onLibrary={onLibrary} />));
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-history-controls')).toHaveLength(0);
    for (const [id, action] of [['beat-editor-add-track', onAdd], ['beat-editor-ai', onAi]] as const) {
        const button = root.container.queryAll(n => n.props.testID === id && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
        expect(button.props.accessibilityLabel).toBeTruthy();
        await act(async () => (button.props.onClick ?? button.props.onPress)({ nativeEvent: {} }));
        expect(action).toHaveBeenCalledTimes(1);
    }
    const ai = root.container.queryAll(n => n.props.testID === 'beat-editor-ai' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    expect(RN.StyleSheet.flatten(ai.props.style)).toMatchObject({ minWidth: 44, minHeight: 52 });
    expect(ai.props.accessibilityLabel).toBe(t('beatAi.title'));
    expect(ai.queryAll(n => n.props.children === t('beatMix.dock.ai'))).toHaveLength(1);
    const actions = ['beat-editor-add-track', 'beat-editor-ai', 'beat-editor-play', 'beat-editor-mixer', 'beat-editor-library'];
    expect(actions.map(id => root.container.queryAll(n => n.props.testID === id && typeof (n.props.onClick ?? n.props.onPress) === 'function').length)).toEqual([1, 1, 1, 1, 1]);
});

test('disabled AI dock action explains the active editor lock to VoiceOver', async () => {
    const hint = t('beatTakes.locked');
    await act(async () => root.render(<BeatEditorTransport {...props} showPatterns={false} showHistory={false}
        onAi={jest.fn()} aiDisabled aiHint={hint} />));
    const ai = root.container.queryAll(n => n.props.testID === 'beat-editor-ai' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    expect(ai.props.accessibilityState.disabled).toBe(true);
    expect(ai.props.accessibilityHint).toBe(hint);

    await act(async () => root.render(<BeatEditorTransport {...props} showPatterns={false} showHistory={false}
        onAi={jest.fn()} aiHint={hint} />));
    const enabledAi = root.container.queryAll(n => n.props.testID === 'beat-editor-ai' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    expect(enabledAi.props.accessibilityState.disabled).toBe(false);
    expect(enabledAi.props.accessibilityHint).toBeUndefined();
});

test('selected AI dock icon uses the same visible accent ink as other selected tools', async () => {
    const controls = { showPatterns: false, showHistory: false, onAdd: jest.fn(), onAi: jest.fn(), onLibrary: jest.fn() };
    await act(async () => root.render(<BeatEditorTransport {...props} {...controls} aiOpen />));
    const selectedAi = root.container.queryAll(n => n.props.testID === 'beat-editor-ai')[0];
    const aiTint = RN.StyleSheet.flatten(selectedAi.queryAll(n => RN.StyleSheet.flatten(n.props.style)?.width === 20)[0].props.style).tintColor;
    await act(async () => root.render(<BeatEditorTransport {...props} {...controls} mixerOpen />));
    const selectedMixer = root.container.queryAll(n => n.props.testID === 'beat-editor-mixer')[0];
    const mixerTint = RN.StyleSheet.flatten(selectedMixer.queryAll(n => RN.StyleSheet.flatten(n.props.style)?.width === 20)[0].props.style).tintColor;
    expect(aiTint).toBe(mixerTint);
});

test('selected bottom tool owns one inline submenu directly below the dock', async () => {
    const onAdd = jest.fn();
    await act(async () => root.render(<BeatEditorTransport {...props} showPatterns={false} showHistory={false}
        addOpen onAdd={onAdd} subMenu={<RN.View testID="inline-add-tools" />} />));
    const add = root.container.queryAll(n => n.props.testID === 'beat-editor-add-track' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    expect(add.props.accessibilityState.selected).toBe(true);
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-submenu')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.testID === 'inline-add-tools')).toHaveLength(1);
});

test('Mix has a selected state and owns the same single inline submenu slot', async () => {
    const onMixer = jest.fn();
    await act(async () => root.render(<BeatEditorTransport {...props} showPatterns={false} showHistory={false}
        mixerOpen onMixer={onMixer} subMenu={<RN.View testID="inline-mix-tools" />} />));
    const mixer = root.container.queryAll(n => n.props.testID === 'beat-editor-mixer' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    expect(mixer.props.accessibilityState.selected).toBe(true);
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-submenu')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.testID === 'inline-mix-tools')).toHaveLength(1);
});

test.each(['countIn', 'recording'] as const)('focused music dock replaces Play with one persistent MIDI stop during %s', async phase => {
    const onMidiRecord = jest.fn();
    await act(async () => root.render(<BeatEditorTransport {...props} showPatterns={false} showHistory={false}
        midiRecordPhase={phase} onMidiRecord={onMidiRecord} onAdd={jest.fn()} onAi={jest.fn()} onLibrary={jest.fn()} />));
    expect(root.container.queryAll(n => n.props.testID === 'beat-midi-record-control')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-play')).toHaveLength(0);
    for (const id of ['beat-editor-add-track', 'beat-editor-ai', 'beat-editor-mixer', 'beat-editor-library']) {
        expect(root.container.queryAll(n => n.props.testID === id && typeof (n.props.onClick ?? n.props.onPress) === 'function')).toHaveLength(1);
    }
});

test('accessible focused dock keeps icon actions unclipped and named for assistive technology', async () => {
    mockDimensions = { ...mockDimensions, height: 667, fontScale: 3.12 };
    await act(async () => root.render(<BeatEditorTransport {...props} showPatterns={false} showHistory={false}
        onAdd={jest.fn()} onAi={jest.fn()} onLibrary={jest.fn()} />));
    for (const id of ['beat-editor-add-track', 'beat-editor-ai', 'beat-editor-play', 'beat-editor-mixer', 'beat-editor-library']) {
        const button = root.container.queryAll(n => n.props.testID === id && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
        expect(button.props.accessibilityLabel).toBeTruthy();
        expect(button.queryAll(n => n.props.numberOfLines === 1)).toHaveLength(0);
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

test('keyboard owner keeps the dock in layout while shrinking the inline tray and dropping bottom safe-area padding', async () => {
    await act(async () => root.render(<BeatEditorTransport {...props} subMenu={<RN.View testID="keyboard-tray" />} />));
    const origin = () => root.container.queryAll(n => n.props.testID === 'beat-editor-keyboard-origin')[0];
    const trayHeight = () => RN.StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'beat-editor-submenu-viewport')[0].props.style).maxHeight;
    const before = trayHeight();
    expect(RN.StyleSheet.flatten(origin().props.style).transform).toBeUndefined();
    await act(async () => keyboardCallbacks.keyboardWillShow?.({ endCoordinates: { height: 300 } }));
    expect(RN.StyleSheet.flatten(origin().props.style).transform).toBeUndefined();
    expect(trayHeight()).toBeLessThan(before);
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport')[0].props.edges).toEqual(['left', 'right']);
    await act(async () => keyboardCallbacks.keyboardWillHide?.());
    expect(RN.StyleSheet.flatten(origin().props.style).transform).toBeUndefined();
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport')[0].props.edges).toEqual(['left', 'right', 'bottom']);
});

test('short inline tools use only their content height while Library can claim the full tray budget', async () => {
    await act(async () => root.render(<BeatEditorTransport {...props} availableHeight={667}
        subMenu={<RN.View testID="short-tray" />} />));
    const viewport = () => RN.StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'beat-editor-submenu-viewport')[0].props.style);
    expect(viewport().maxHeight).toBeGreaterThan(0);
    expect(viewport().height).toBeUndefined();
    expect(RN.StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'beat-editor-submenu-content')[0].props.style)).toMatchObject({
        flexShrink: 1,
        minHeight: 0,
    });

    await act(async () => root.render(<BeatEditorTransport {...props} availableHeight={667} subMenuFillsBudget
        subMenu={<RN.View testID="library-tray" />} />));
    expect(viewport().height).toBe(viewport().maxHeight);
    expect(RN.StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'beat-editor-submenu-content')[0].props.style)).toMatchObject({
        flex: 1,
        flexShrink: 1,
        minHeight: 0,
    });
});

test('normal short-landscape tray renders compact history and recovery status above its tools', async () => {
    mockDimensions = { ...mockDimensions, width: 874, height: 402 };
    await act(async () => root.render(<BeatEditorTransport {...props} availableHeight={402} showPatterns={false} showHistory={false}
        onAdd={jest.fn()} onAi={jest.fn()} onLibrary={jest.fn()}
        compactStatus={<RN.View testID="short-landscape-history-and-recovery" />}
        subMenuLabel="Mixer" subMenu={<RN.View testID="short-landscape-mixer" />} />));
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-compact-viewport')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.testID === 'short-landscape-history-and-recovery')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.testID === 'short-landscape-mixer')).toHaveLength(1);
    expect(RN.StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'beat-editor-compact-status-slot')[0].props.style).flexShrink).toBe(0);
    expect(RN.StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'beat-editor-submenu-content')[0].props.style)).toMatchObject({
        flexShrink: 1,
        minHeight: 0,
    });
});

test('193pt landscape viewport keeps a 44pt one-row dock and a usable horizontal-tray budget', async () => {
    mockDimensions = { ...mockDimensions, width: 874, height: 390 };
    await act(async () => root.render(<BeatEditorTransport {...props} availableHeight={193} showPatterns={false} showHistory={false}
        onAdd={jest.fn()} onAi={jest.fn()} onLibrary={jest.fn()} subMenuLabel="Add a track" subMenu={<RN.View testID="compact-tray" />} />));
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-compact-viewport')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.props.accessibilityLabel === 'Add a track')).toHaveLength(1);
    const viewport = root.container.queryAll(n => n.props.testID === 'beat-editor-submenu-viewport')[0];
    expect(RN.StyleSheet.flatten(viewport.props.style).maxHeight).toBe(48);
    expect(RN.StyleSheet.flatten(viewport.props.style).height).toBe(48);
    for (const id of ['beat-editor-add-track', 'beat-editor-ai', 'beat-editor-play', 'beat-editor-mixer', 'beat-editor-library']) {
        const button = root.container.queryAll(n => n.props.testID === id && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
        expect(RN.StyleSheet.flatten(button.props.style).minHeight).toBe(44);
        expect(button.props.accessibilityLabel).toBeTruthy();
    }
});

test('keyboard editing expands the compact tray so its focused input and first result remain visible', async () => {
    mockDimensions = { ...mockDimensions, width: 874, height: 390 };
    await act(async () => root.render(<BeatEditorTransport {...props} availableHeight={193} showPatterns={false} showHistory={false}
        onAdd={jest.fn()} onAi={jest.fn()} onLibrary={jest.fn()} compactStatus={<RN.View testID="compact-editor-status" />}
        subMenuLabel="Veyrnox Library" subMenu={<RN.View testID="compact-library-results" />} />));
    const trayHeight = () => RN.StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'beat-editor-submenu-viewport')[0].props.style).height;
    expect(trayHeight()).toBe(48);
    expect(root.container.queryAll(n => n.props.testID === 'compact-editor-status')).toHaveLength(1);
    await act(async () => keyboardCallbacks.keyboardWillShow?.({ endCoordinates: { height: 300 } }));
    await act(async () => root.render(<BeatEditorTransport {...props} availableHeight={160} showPatterns={false} showHistory={false}
        onAdd={jest.fn()} onAi={jest.fn()} onLibrary={jest.fn()} compactStatus={<RN.View testID="compact-editor-status" />}
        subMenuLabel="Veyrnox Library" subMenu={<RN.View testID="compact-library-results" />} />));
    expect(trayHeight()).toBe(71);
    expect(root.container.queryAll(n => n.props.testID === 'compact-library-results')).toHaveLength(1);
});

test('route-owned compactness keeps portrait keyboard trays aligned with the arrangement', async () => {
    mockDimensions = { ...mockDimensions, width: 390, height: 844 };
    await act(async () => root.render(<BeatEditorTransport {...props} availableHeight={193} compactViewport
        showPatterns={false} showHistory={false} onAdd={jest.fn()} onAi={jest.fn()} onLibrary={jest.fn()}
        subMenuLabel="AI music" subMenu={<RN.View testID="portrait-keyboard-ai-tray" />} />));
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-compact-viewport')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.props.accessibilityLabel === 'AI music')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.testID === 'portrait-keyboard-ai-tray')).toHaveLength(1);
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

test('short landscape removes transport status chrome to preserve the timeline', async () => {
    mockDimensions = { ...mockDimensions, width: 844, height: 390, fontScale: 1 };
    await render();
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-status')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.testID === 'beat-editor-transport-controls-compact')).toHaveLength(1);
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
