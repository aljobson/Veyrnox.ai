import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicMixerTray, restoreMixerControlFocus } from '../src/components/beats/MusicMixerTray';
import { StrengthSlider } from '../src/components/StrengthSlider';
import { addKitTrack } from '../src/lib/beatNative/doc';
import { addAutomationPoint } from '../src/lib/beatNative/mix';
import { musicTrayMaxHeight } from '../src/lib/beatNative/editorLayout';
import { newBeat, resetBeats } from '../src/lib/beatNative/store';
import { t } from '../src/lib/i18n';

let mockDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ default: () => mockDimensions }));
void [RN.View, RN.Pressable, RN.Text, RN.ScrollView];

let root: Root;
const callbacks = () => ({
    apply: jest.fn((_edit?: unknown, _label?: string) => true), onGain: jest.fn(), onPan: jest.fn(),
    onMute: jest.fn(), onSolo: jest.fn(), onKit: jest.fn(), onRemove: jest.fn(), onExpansionChange: jest.fn(),
});
const live = { audio: null, playing: false, step: null, notice: null, layout: 'compact' as const };
const press = async (testID: string) => {
    const node = root.container.queryAll(item => item.props.testID === testID && typeof (item.props.onClick ?? item.props.onPress) === 'function')[0];
    await act(async () => (node.props.onClick ?? node.props.onPress)({ nativeEvent: {} }));
};

beforeAll(() => require('../src/lib/beatNative/store').beatStore.setOwner('music-mixer-test'));
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockDimensions = { width: 390, height: 844, scale: 3, fontScale: 1 }; resetBeats(); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); resetBeats(); });

test('keeps common mixing inline while track choice stays local to the mixer', async () => {
    const doc = addKitTrack(newBeat('Inline mix'), '808');
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled={false} {...actions} />));
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-tray')).toHaveLength(1);
    expect(RN.StyleSheet.flatten(root.container.queryAll(node => node.props.testID === 'music-mixer-tray')[0].props.style))
        .toMatchObject({ flexShrink: 1, minHeight: 0 });
    expect(root.container.queryAll(node => node.props.transparent && node.props.presentationStyle === 'overFullScreen')).toHaveLength(0);
    await press('music-mixer-mute');
    expect(actions.onMute).toHaveBeenCalledWith(doc.tracks[0].id, true);
    await press(`music-mixer-track-${doc.tracks[1].id}`);
    expect(root.container.queryAll(node => node.props.accessibilityLabel === t('beat.mute', { track: doc.tracks[1].name }))).toHaveLength(1);
    await press('music-mixer-advanced');
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-advanced-panel')).toHaveLength(1);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-selected-track-details')).toHaveLength(1);
    for (const label of [t('beat.gain', { track: doc.tracks[1].name }), t('beat.pan', { track: doc.tracks[1].name }),
        t('beat.mute', { track: doc.tracks[1].name }), t('beat.solo', { track: doc.tracks[1].name })]) {
        expect(root.container.queryAll(node => node.props.accessibilityLabel === label)).toHaveLength(1);
    }
    await press('music-mixer-advanced-back');
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-advanced-panel')).toHaveLength(0);
});

test('compact landscape exposes track, gain, pan, mute, solo, and tools in one 44pt essentials row', async () => {
    mockDimensions = { width: 874, height: 390, scale: 3, fontScale: 1 };
    const doc = addKitTrack(newBeat('Compact mix'), '808');
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} compact mixDisabled={false} structuralDisabled={false} {...actions} />));
    const row = root.container.queryAll(node => node.props.testID === 'music-mixer-compact-essentials')[0];
    expect(row.props.horizontal).toBe(true);
    expect(row.props.showsHorizontalScrollIndicator).toBe(false);
    expect(RN.StyleSheet.flatten(row.props.style)).toMatchObject({ height: 44, minHeight: 44 });
    expect(RN.StyleSheet.flatten(row.props.contentContainerStyle)).toMatchObject({ height: 44, minHeight: 44, flexDirection: 'row' });
    for (const id of ['music-mixer-track-selected', 'music-mixer-gain', 'music-mixer-pan', 'music-mixer-mute', 'music-mixer-solo', 'music-mixer-track-tools']) {
        expect(row.queryAll(node => node.props.testID === id)).toHaveLength(1);
    }
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-top-row')).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-controls')).toHaveLength(0);
    await press('music-mixer-track-tools');
    expect(actions.onExpansionChange).toHaveBeenCalledWith(true);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-essentials')).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-track-tools-level')).toHaveLength(1);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-track-tools-back')[0].props.accessibilityLabel)
        .toBe(t('beat.back'));
    expect(root.container.queryAll(node => node.props.accessibilityLabel?.includes('Sound for'))).toHaveLength(1);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-remove-track')).toHaveLength(1);
    await press('music-mixer-compact-track-tools-back');
    expect(actions.onExpansionChange).toHaveBeenLastCalledWith(false);
    await press('music-mixer-track-selected');
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-tools-level')).toHaveLength(1);
    const compactAdvanced = root.container.queryAll(node => node.props.testID === 'music-mixer-advanced')[0];
    expect(compactAdvanced).toBeTruthy();
    expect(compactAdvanced.props.accessibilityState?.expanded).toBeUndefined();
    await press('music-mixer-advanced');
    expect(actions.onExpansionChange).toHaveBeenCalledWith(true);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-advanced-level')).toHaveLength(1);
    await press('music-mixer-compact-advanced-back');
    expect(actions.onExpansionChange).toHaveBeenLastCalledWith(false);
    await press(`music-mixer-track-${doc.tracks[1].id}`);
    expect(root.container.queryAll(node => node.props.accessibilityLabel === t('beat.mute', { track: doc.tracks[1].name }))).toHaveLength(1);
});

test('non-compact Tools replaces Advanced instead of stacking both levels', async () => {
    const doc = newBeat('Exclusive mixer levels');
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled={false} {...callbacks()} />));
    await press('music-mixer-advanced');
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-advanced-panel')).toHaveLength(1);
    await press('music-mixer-track-tools');
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-advanced-panel')).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-track-tools-panel')).toHaveLength(1);
});

test('390pt compact keyboard layout keeps mute, solo, and tools reachable in a contained horizontal strip', async () => {
    mockDimensions = { width: 390, height: 193, scale: 3, fontScale: 1 };
    const doc = newBeat('Compact portrait mix');
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} compact mixDisabled={false} structuralDisabled={false} {...actions} />));
    const row = root.container.queryAll(node => node.props.testID === 'music-mixer-compact-essentials')[0];
    expect(row.props.horizontal).toBe(true);
    expect(row.props.nestedScrollEnabled).toBe(true);
    for (const id of ['music-mixer-mute', 'music-mixer-solo', 'music-mixer-track-tools']) {
        const action = row.queryAll(node => node.props.testID === id && typeof (node.props.onClick ?? node.props.onPress) === 'function')[0];
        expect(action).toBeTruthy();
        expect(RN.StyleSheet.flatten(action.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
    }
    await press('music-mixer-mute');
    await press('music-mixer-solo');
    expect(actions.onMute).toHaveBeenCalledWith(doc.tracks[0].id, true);
    expect(actions.onSolo).toHaveBeenCalledWith(doc.tracks[0].id, true);
});

test('compact gain drag owns the responder and pauses the parent scroller', async () => {
    mockDimensions = { width: 390, height: 193, scale: 3, fontScale: 1 };
    const doc = newBeat('Compact drag mix');
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} compact mixDisabled={false} structuralDisabled={false} {...actions} />));
    const gain = root.container.queryAll(node => node.props.testID === 'music-mixer-gain')[0];
    let hit = gain.queryAll(node => typeof node.props.onResponderGrant === 'function')[0];
    await act(async () => hit.props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
    const touch = (locationX: number, time: number, previousPageX = locationX) => ({
        nativeEvent: { locationX },
        touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: time,
            touchBank: [{ touchActive: true, currentTimeStamp: time, currentPageX: locationX, currentPageY: 0,
                previousPageX, previousPageY: 0 }] },
    });
    await act(async () => hit.props.onResponderGrant(touch(25, 1)));
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-essentials')[0].props.scrollEnabled).toBe(false);
    hit = root.container.queryAll(node => node.props.testID === 'music-mixer-gain')[0]
        .queryAll(node => typeof node.props.onResponderMove === 'function')[0];
    expect(hit.props.onResponderTerminationRequest()).toBe(false);
    await act(async () => hit.props.onResponderMove(touch(75, 2, 25)));
    expect(actions.onGain).toHaveBeenLastCalledWith(doc.tracks[0].id, 0.75);
    await act(async () => hit.props.onResponderRelease());
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-essentials')[0].props.scrollEnabled).toBe(true);
});

test('slider gesture locking is opt-in so shared scrolling forms can still take over', async () => {
    const onChange = jest.fn();
    const spy = jest.spyOn(RN.PanResponder, 'create');
    try {
        await act(async () => root.render(<StrengthSlider label="Shared slider" value={0.5} onChange={onChange} />));
        const callbacks = spy.mock.calls.at(-1)?.[0];
        expect(callbacks?.onPanResponderTerminationRequest?.({} as never, {} as never)).toBe(true);
        expect(callbacks?.onShouldBlockNativeResponder?.({} as never, {} as never)).toBe(true);

        await act(async () => root.render(<StrengthSlider label="Locked slider" value={0.5} lockGesture onChange={onChange} />));
        expect(callbacks?.onPanResponderTerminationRequest?.({} as never, {} as never)).toBe(false);
        expect(callbacks?.onShouldBlockNativeResponder?.({} as never, {} as never)).toBe(true);
    } finally {
        spy.mockRestore();
    }
});

test('mixer focus restoration resolves and focuses the invoking control', () => {
    const trigger = {} as never;
    const resolve = jest.fn(() => 42);
    const focus = jest.fn();
    restoreMixerControlFocus(trigger, resolve, focus);
    expect(resolve).toHaveBeenCalledWith(trigger);
    expect(focus).toHaveBeenCalledWith(42);
});

test('compact track picker Back restores focus to the selected-track trigger', async () => {
    mockDimensions = { width: 390, height: 193, scale: 3, fontScale: 1 };
    const doc = newBeat('Compact focus');
    const requestFrame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
        callback(0);
        return 1;
    });
    try {
        await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
            {...live} compact mixDisabled={false} structuralDisabled={false} {...callbacks()} />));
        await press('music-mixer-track-selected');
        expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-tools-level')).toHaveLength(1);
        await press('music-mixer-compact-tools-back');
        expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-tools-level')).toHaveLength(0);
        expect(requestFrame).toHaveBeenCalledTimes(1);
    } finally {
        requestFrame.mockRestore();
    }
});

test('compact structural tools collapse their expanded tray budget when recording locks engage', async () => {
    mockDimensions = { width: 874, height: 390, scale: 3, fontScale: 1 };
    const doc = addKitTrack(newBeat('Compact lock'), '808');
    const actions = callbacks();
    const render = (structuralDisabled: boolean) => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} compact mixDisabled={false} structuralDisabled={structuralDisabled} {...actions} />);
    await act(async () => render(false));
    await press('music-mixer-track-tools');
    expect(actions.onExpansionChange).toHaveBeenLastCalledWith(true);
    await act(async () => render(true));
    expect(actions.onExpansionChange).toHaveBeenLastCalledWith(false);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-track-tools-level')).toHaveLength(0);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-essentials')).toHaveLength(1);
});

test('compact automation shortcut is disabled while structural recording locks are active', async () => {
    mockDimensions = { width: 874, height: 390, scale: 3, fontScale: 1 };
    let doc = newBeat('Compact locked automation');
    doc = addAutomationPoint(doc, doc.tracks[0].id, 'gain', 0, 0.5);
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} compact mixDisabled={false} structuralDisabled {...actions} />));
    const shortcut = root.container.queryAll(node => node.props.testID === 'music-mixer-compact-automation-lock')[0];
    expect(shortcut.props.accessibilityState.disabled).toBe(true);
    expect(shortcut.props.accessibilityHint).toBeTruthy();
    await act(async () => shortcut.props.onClick({ nativeEvent: {} }));
    expect(actions.onExpansionChange).not.toHaveBeenCalledWith(true);
});

test('locks automated controls and keeps structural tools height-capped', async () => {
    let doc = newBeat('Automation');
    doc = addAutomationPoint(doc, doc.tracks[0].id, 'gain', 0, 0.5);
    doc = addAutomationPoint(doc, doc.tracks[0].id, 'pan', 0, 0.25);
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled={false} {...actions} />));
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-automation-lock')).toHaveLength(1);
    const sliders = root.container.queryAll(node => node.props.accessibilityRole === 'adjustable');
    expect(sliders[0].props.accessibilityState.disabled).toBe(true);
    expect(sliders[0].props.accessibilityHint).toBeTruthy();
    expect(sliders[1].props.accessibilityState.disabled).toBe(true);
    expect(sliders[1].props.accessibilityHint).toBeTruthy();
    expect(root.container.queryAll(node => node.props.children === t('beatMix.locked.gain'))).toHaveLength(1);
    expect(root.container.queryAll(node => node.props.children === t('beatMix.locked.pan'))).toHaveLength(1);
    await press('music-mixer-track-tools');
    const panel = root.container.queryAll(node => node.props.testID === 'music-mixer-track-tools-panel')[0];
    expect(RN.StyleSheet.flatten(panel.props.style).maxHeight).toBeGreaterThanOrEqual(132);
    expect(root.container.queryAll(node => node.props.accessibilityLabel?.includes('Sound for'))).toHaveLength(1);
});

test('selected-track tools retain kit and remove actions without a second header mixer', async () => {
    const doc = addKitTrack(newBeat('Structure'), 'lofi');
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled={false} {...actions} />));
    await press('music-mixer-track-tools');
    await press('music-mixer-remove-track');
    expect(actions.onRemove).toHaveBeenCalledWith(doc.tracks[0].id);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-track-tools-panel')).toHaveLength(0);
});

test('keeps live mix controls available during a take while structural tools remain locked', async () => {
    const doc = addKitTrack(newBeat('Recording mix'), 'lofi');
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled {...actions} />));
    const mute = root.container.queryAll(node => node.props.testID === 'music-mixer-mute')[0];
    expect(mute.props.accessibilityState.disabled).toBe(false);
    await press('music-mixer-mute');
    expect(actions.onMute).toHaveBeenCalledWith(doc.tracks[0].id, true);
    await press(`music-mixer-track-${doc.tracks[1].id}`);
    await press('music-mixer-mute');
    expect(actions.onMute).toHaveBeenLastCalledWith(doc.tracks[1].id, true);
    await press('music-mixer-track-tools');
    const remove = root.container.queryAll(node => node.props.testID === 'music-mixer-remove-track')[0];
    expect(remove.props.accessibilityState.disabled).toBe(true);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-advanced')[0].props.accessibilityState.disabled).toBe(true);
});

test('disables mixer-local track selection only when mixing itself is locked', async () => {
    const doc = addKitTrack(newBeat('Locked mixing'), 'lofi');
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled structuralDisabled selectionDisabled {...actions} />));
    const track = root.container.queryAll(node => node.props.testID === `music-mixer-track-${doc.tracks[1].id}`)[0];
    expect(track.props.accessibilityState.disabled).toBe(true);
    await act(async () => track.props.onClick({ nativeEvent: {} }));
    expect(root.container.queryAll(node => node.props.accessibilityLabel === t('beat.mute', { track: doc.tracks[0].name }))).toHaveLength(1);
});

test.each([
    [390, 844, 282],
    [375, 667, 215],
] as const)('%ipt × %ipt portrait keeps every mixer essential inside the %ipt tray budget', async (width, height, budget) => {
    mockDimensions = { width, height, scale: 3, fontScale: 1 };
    const doc = newBeat('Portrait mix');
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled={false} {...callbacks()} />));
    expect(musicTrayMaxHeight(width, height)).toBe(budget);
    const top = root.container.queryAll(node => node.props.testID === 'music-mixer-top-row')[0];
    const controls = root.container.queryAll(node => node.props.testID === 'music-mixer-controls')[0];
    const tray = root.container.queryAll(node => node.props.testID === 'music-mixer-tray')[0];
    expect(RN.StyleSheet.flatten(controls.props.style).flexDirection).toBe('row');
    expect(controls.queryAll(node => ['music-mixer-mute', 'music-mixer-solo'].includes(node.props.testID))).toHaveLength(0);
    for (const id of ['music-mixer-mute', 'music-mixer-solo', 'music-mixer-track-tools', 'music-mixer-advanced']) {
        const action = top.queryAll(node => node.props.testID === id && typeof (node.props.onClick ?? node.props.onPress) === 'function')[0];
        expect(RN.StyleSheet.flatten(action.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
    }
    const topHeight = RN.StyleSheet.flatten(top.props.style).minHeight;
    const controlHeight = RN.StyleSheet.flatten(controls.props.style).minHeight;
    const gap = RN.StyleSheet.flatten(tray.props.contentContainerStyle).gap;
    expect(topHeight + controlHeight + gap).toBeLessThanOrEqual(budget);
});

test.each([
    [359, 'column'],
    [360, 'row'],
] as const)('%ipt normal layout uses a %s fader layout at the narrow breakpoint', async (width, direction) => {
    mockDimensions = { width, height: 667, scale: 3, fontScale: 1 };
    const doc = newBeat('Narrow mix');
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled={false} {...callbacks()} />));
    expect(RN.StyleSheet.flatten(root.container.queryAll(node => node.props.testID === 'music-mixer-controls')[0].props.style).flexDirection)
        .toBe(direction);
});

test('accessible layout stacks the essential faders while leaving toggles in the top row', async () => {
    mockDimensions = { width: 844, height: 390, scale: 3, fontScale: 3.12 };
    const doc = newBeat('Landscape mix');
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} layout="accessible" mixDisabled={false} structuralDisabled={false} {...callbacks()} />));
    expect(RN.StyleSheet.flatten(root.container.queryAll(node => node.props.testID === 'music-mixer-controls')[0].props.style).flexDirection).toBe('column');
    const top = root.container.queryAll(node => node.props.testID === 'music-mixer-top-row')[0];
    expect(top.queryAll(node => ['music-mixer-mute', 'music-mixer-solo'].includes(node.props.testID)
        && typeof (node.props.onClick ?? node.props.onPress) === 'function')).toHaveLength(2);
});

test.each([
    [0, t('beatMix.pan.center')],
    [-0.4, t('beatMix.pan.left', { percent: 40 })],
    [0.4, t('beatMix.pan.right', { percent: 40 })],
] as const)('announces pan %s with music-specific direction copy', async (pan, valueText) => {
    const base = newBeat('Pan labels');
    const doc = { ...base, tracks: base.tracks.map((track, index) => index === 0 ? { ...track, pan } : track) };
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled={false} {...callbacks()} />));
    const slider = root.container.queryAll(node => node.props.testID === 'music-mixer-pan')[0];
    expect(slider.props.accessibilityValue).toMatchObject({ now: pan * 100, text: valueText });
});

test('VoiceOver adjusts pan in ten-percent steps that match the announced range', async () => {
    const doc = newBeat('Accessible pan');
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled={false} {...actions} />));
    const slider = root.container.queryAll(node => node.props.testID === 'music-mixer-pan')[0];
    await act(async () => slider.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(actions.onPan).toHaveBeenCalledWith(doc.tracks[0].id, 0.1);
});

test('clearing an automation lane unlocks its inline fader', async () => {
    let doc = newBeat('Automation clear');
    doc = addAutomationPoint(doc, doc.tracks[0].id, 'gain', 0, 0.5);
    const actions = callbacks();
    actions.apply.mockImplementation((edit: any) => { doc = edit(doc); return true; });
    const renderTray = async () => act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} mixDisabled={false} structuralDisabled={false} {...actions} />));
    await renderTray();
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-gain')[0].props.accessibilityState.disabled).toBe(true);
    await press('music-mixer-advanced');
    await press('music-mixer-selected-track-details');
    const showLane = root.container.queryAll(node => node.props.accessibilityLabel === t('beatMix.lane.show.gain') && typeof (node.props.onClick ?? node.props.onPress) === 'function')[0];
    await act(async () => (showLane.props.onClick ?? showLane.props.onPress)({ nativeEvent: {} }));
    const clear = root.container.queryAll(node => node.props.accessibilityLabel === t('beatMix.lane.clear') && typeof (node.props.onClick ?? node.props.onPress) === 'function')[0];
    await act(async () => (clear.props.onClick ?? clear.props.onPress)({ nativeEvent: {} }));
    await renderTray();
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-gain')[0].props.accessibilityState.disabled).toBe(false);
});

test('compact automated fader shows a visible shortcut to its clearable lane', async () => {
    mockDimensions = { width: 874, height: 390, scale: 3, fontScale: 1 };
    let doc = newBeat('Compact automation');
    doc = addAutomationPoint(doc, doc.tracks[0].id, 'gain', 0, 0.5);
    const actions = callbacks();
    await act(async () => root.render(<MusicMixerTray doc={doc} selectedTrackId={doc.tracks[0].id}
        {...live} compact mixDisabled={false} structuralDisabled={false} {...actions} />));
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-automation-lock')).toHaveLength(1);
    await press('music-mixer-compact-automation-lock');
    expect(actions.onExpansionChange).toHaveBeenLastCalledWith(true);
    expect(root.container.queryAll(node => node.props.testID === 'music-mixer-compact-advanced-level')).toHaveLength(1);
    expect(root.container.queryAll(node => node.props.children === t('beatMix.lane.clear'))).toHaveLength(1);
});
