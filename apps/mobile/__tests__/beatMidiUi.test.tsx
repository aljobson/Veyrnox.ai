import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatKeyboard } from '../src/components/beats/BeatKeyboard';
import { BeatMidiRecordPanel } from '../src/components/beats/BeatMidiRecordPanel';
import { BeatMidiRecoveryCard } from '../src/components/beats/BeatMidiRecoveryCard';

void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Switch];

const track = { id: 'midi-1', name: 'Piano', type: 'instrument' as const, gain: 1, pan: 0, mute: false, solo: false,
    instrument: { engine: 'voice' as const, id: 'piano', preset: 'grand' } };
const audio = { now: jest.fn(() => 12.5), noteOn: jest.fn(async () => {}), noteOff: jest.fn(), releaseKeys: jest.fn() };
let root: Root;

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    jest.clearAllMocks();
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(async () => {
    await act(async () => root.unmount());
    jest.restoreAllMocks();
    jest.useRealTimers();
});

const keyboardProps = {
    track,
    velocity: 96,
    setVelocity: jest.fn(),
    audio: () => audio as never,
    onError: jest.fn(),
};

test('keyboard emits audio-clock normalized events and exposes held state without colour alone', async () => {
    const onNoteOn = jest.fn();
    const onNoteOff = jest.fn();
    await act(async () => root.render(<BeatKeyboard {...keyboardProps} captureActive onNoteOn={onNoteOn} onNoteOff={onNoteOff} />));
    const key = root.container.queryAll(n => n.props.testID === 'beat-key-60')[0];
    const event = { persist() {}, currentTarget: 1, nativeEvent: { pageX: 0, pageY: 0, locationX: 0, locationY: 0 } };
    await act(async () => key.props.onResponderGrant(event));
    expect(onNoteOn).toHaveBeenCalledWith({ keyId: 'touch:60', pitch: 60, velocity: 96, contextTime: 12.5, source: 'touch' });
    expect(audio.noteOn).toHaveBeenCalledWith('touch:60', track, 60, 96);
    const selectedKey = root.container.queryAll(n => n.props.testID === 'beat-key-60')[0];
    expect(selectedKey.props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    expect(RN.StyleSheet.flatten(selectedKey.props.style).borderWidth).toBe(3);
    await act(async () => selectedKey.props.onBlur());
    expect(onNoteOff).toHaveBeenCalledWith({ keyId: 'touch:60', pitch: 60, velocity: 96, contextTime: 12.5, source: 'touch' });
});

test('accessibility activation has a deterministic finite release and musical ordering stays LTR', async () => {
    jest.useFakeTimers();
    const onNoteOff = jest.fn();
    await act(async () => root.render(<BeatKeyboard {...keyboardProps} captureActive accessibilityNoteDurationMs={120} onNoteOff={onNoteOff} />));
    const key = root.container.queryAll(n => n.props.testID === 'beat-key-60')[0];
    await act(async () => key.props.onAccessibilityTap());
    expect(root.container.queryAll(n => n.props.testID === 'beat-key-60')[0].props.accessibilityState.selected).toBe(true);
    await act(async () => jest.advanceTimersByTime(120));
    expect(onNoteOff).toHaveBeenCalledWith(expect.objectContaining({ pitch: 60, source: 'accessibility' }));
    const scroller = root.container.queryAll(n => n.props.horizontal && n.props.accessibilityLabel)[0];
    expect(RN.StyleSheet.flatten(scroller.props.style).direction).toBe('ltr');
    expect(RN.StyleSheet.flatten(scroller.props.contentContainerStyle)).toMatchObject({ direction: 'ltr', flexDirection: 'row' });
});

test('record panel wraps settings, keeps 44pt switches, and uses static count and record cues', async () => {
    await act(async () => root.render(<BeatMidiRecordPanel {...keyboardProps} phase="countIn" noteCount={3}
        countIn countInStep={2} quantise settingsDisabled layout="accessible"
        onCountInChange={jest.fn()} onQuantiseChange={jest.fn()} lockReason="Recording controls are locked." />));
    for (const id of ['beat-midi-count-in', 'beat-midi-quantise']) {
        const control = root.container.queryAll(n => n.props.testID === id)[0];
        expect(control.props.accessibilityState.disabled).toBe(true);
        expect(RN.StyleSheet.flatten(control.props.style)).toMatchObject({ minWidth: 44, minHeight: 44 });
    }
    const status = root.container.queryAll(n => n.props.testID === 'beat-midi-record-status')[0];
    expect(status.props.accessibilityLiveRegion).toBeUndefined();
    expect(root.container.queryAll(n => n.props.testID === 'beat-midi-record-lock')).toHaveLength(1);
});

test('recovery modes expose only valid primary actions and confirm destructive discard', async () => {
    const onDiscard = jest.fn();
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    await act(async () => root.render(<BeatMidiRecoveryCard mode="conflict" canSaveAsNew onSaveAsNew={jest.fn()} onDiscard={onDiscard} />));
    expect(root.container.queryAll(n => n.props.testID === 'beat-midi-retry')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.testID === 'beat-midi-save-new')).toHaveLength(1);
    const discard = root.container.queryAll(n => n.props.testID === 'beat-midi-discard' && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
    await act(async () => (discard.props.onClick ?? discard.props.onPress)({ nativeEvent: {} }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as RN.AlertButton[];
    buttons.find(button => button.style === 'destructive')?.onPress?.();
    expect(onDiscard).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<BeatMidiRecoveryCard mode="restore" onRestore={jest.fn()} onDiscard={onDiscard} />));
    expect(root.container.queryAll(n => n.props.testID === 'beat-midi-restore')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.testID === 'beat-midi-retry')).toHaveLength(0);
});
