import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { PadGrid } from '../src/components/beats/PadGrid';
import { StepGrid } from '../src/components/beats/StepGrid';
import { createBeat, type BeatDoc } from '../src/lib/beatNative/doc';
import { t } from '../src/lib/i18n';

void [RN.View, RN.Text, RN.Pressable];
let root: Root;

const docWithVelocities = (): BeatDoc => {
    const doc = createBeat({ id: '00000000-0000-4000-8000-000000000099', now: 1 });
    return {
        ...doc,
        patterns: {
            ...doc.patterns,
            [doc.currentPattern]: { rows: { ...doc.patterns[doc.currentPattern].rows, kick: [[0, 60], [1, 100], [2, 127]] } },
        },
    };
};
const testId = (id: string) => root.container.queryAll(node => node.props.testID === id);
const byLabel = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === label &&
    typeof (node.props.onPress ?? node.props.onClick ?? node.props.onPressIn ?? node.props.onAccessibilityAction) === 'function')[0];
const touch = (id = 1) => ({
    nativeEvent: { timestamp: id, pageX: 10, pageY: 10, locationX: 10, locationY: 10, touches: [], changedTouches: [], identifier: id, target: id },
    currentTarget: id, target: id, persist: () => {},
});

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });

test('pad rows adapt to regular, compact, and accessibility layouts without truncating labels', async () => {
    const onHit = jest.fn();
    for (const [layout, rows] of [['regular', 1], ['compact', 2], ['accessible', 4]] as const) {
        await act(async () => root.render(<PadGrid selected="kick" onHit={onHit} layout={layout} />));
        expect(root.container.queryAll(node => String(node.props.testID ?? '').startsWith('pad-row-'))).toHaveLength(rows);
    }
    const kick = byLabel(t('beat.pad.hit', { pad: t('beat.pad.kick') }));
    expect(RN.StyleSheet.flatten(kick.props.style).minHeight).toBeGreaterThanOrEqual(44);
    const labels = root.container.queryAll(node => node.children.includes(t('beat.pad.openhat')));
    expect(labels.some(node => node.props.numberOfLines !== undefined)).toBe(false);
});

test('each pad has an independent low-latency touch guard', async () => {
    const onHit = jest.fn();
    await act(async () => root.render(<PadGrid selected="kick" onHit={onHit} />));
    const kick = byLabel(t('beat.pad.hit', { pad: t('beat.pad.kick') }));
    const snare = byLabel(t('beat.pad.hit', { pad: t('beat.pad.snare') }));
    await act(async () => {
        kick.props.onResponderGrant(touch(1));
        snare.props.onResponderGrant(touch(2));
    });
    expect(onHit.mock.calls).toEqual([['kick'], ['snare']]);
});

test('step cells expose exact velocities with separate edit and playhead cues', async () => {
    const doc = docWithVelocities();
    await act(async () => root.render(<StepGrid doc={doc} pad="kick" current={1} onToggle={jest.fn()} onVelocity={jest.fn()} />));
    expect(testId('step-velocity-0')[0].children).toContain('60');
    expect(testId('step-velocity-1')[0].children).toContain('100');
    expect(testId('step-velocity-2')[0].children).toContain('127');
    expect(testId('step-edit-target-0')).toHaveLength(1);
    expect(testId('step-playhead-1')).toHaveLength(1);
    const medium = byLabel(t('beat.step.on', { n: 2, total: 16, pad: t('beat.pad.kick') }));
    expect(medium.props.accessibilityValue.text).toBe(`${t('beat.velocity.medium')}, ${t('beatPiano.keys.velocity', { n: 100 })}`);
    expect(medium.props.accessibilityHint).toBe(t('beat.step.now'));
    expect(RN.StyleSheet.flatten(medium.props.style).minHeight).toBeGreaterThanOrEqual(44);
});

test('hold and accessibility actions cycle velocity without also toggling the step', async () => {
    jest.useFakeTimers();
    const doc = docWithVelocities();
    const onToggle = jest.fn(); const onVelocity = jest.fn();
    await act(async () => root.render(<StepGrid doc={doc} pad="kick" current={null} onToggle={onToggle} onVelocity={onVelocity} />));
    const soft = byLabel(t('beat.step.on', { n: 1, total: 16, pad: t('beat.pad.kick') }));
    await act(async () => { soft.props.onResponderGrant(touch()); jest.advanceTimersByTime(500); soft.props.onResponderRelease(touch()); });
    expect(onVelocity).toHaveBeenCalledWith(0, 1);
    await act(async () => soft.props.onClick({ nativeEvent: {} }));
    expect(onToggle).not.toHaveBeenCalled();
    await act(async () => soft.props.onClick({ nativeEvent: {} }));
    expect(onToggle).toHaveBeenCalledWith(0);
    onToggle.mockClear();
    await act(async () => soft.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(onVelocity).toHaveBeenLastCalledWith(0, 1);
    await act(async () => soft.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
    expect(onVelocity).toHaveBeenLastCalledWith(0, -1);
    const off = byLabel(t('beat.step.off', { n: 4, total: 16, pad: t('beat.pad.kick') }));
    await act(async () => { off.props.onResponderGrant(touch(2)); jest.advanceTimersByTime(500); off.props.onResponderRelease(touch(2)); });
    await act(async () => off.props.onClick({ nativeEvent: {} }));
    expect(onToggle).not.toHaveBeenCalled();
    await act(async () => off.props.onClick({ nativeEvent: {} }));
    expect(onToggle).toHaveBeenCalledWith(3);
});

test('the direct selector chooses the shortest velocity cycle and disables for an off step', async () => {
    const doc = docWithVelocities(); const onVelocity = jest.fn();
    await act(async () => root.render(<StepGrid doc={doc} pad="kick" current={null} onToggle={jest.fn()} onVelocity={onVelocity} />));
    const hard = byLabel(`${t('beat.velocity.hard')}, ${t('beatLabs.control.gridVelocity')} 127`);
    await act(async () => (hard.props.onPress ?? hard.props.onClick)());
    expect(onVelocity).toHaveBeenCalledWith(0, -1);
    const off = byLabel(t('beat.step.off', { n: 4, total: 16, pad: t('beat.pad.kick') }));
    await act(async () => off.props.onClick({ nativeEvent: {} }));
    const selector = root.container.queryAll(node => node.props.accessibilityRole === 'tablist' && node.props.accessibilityLabel === t('beatLabs.control.gridVelocity'))[0];
    expect(selector.props.accessibilityState.disabled).toBe(true);
    expect(selector.props.accessibilityHint).toBe(`${t('beat.pattern.off')}. ${t('beatLabs.touch.gridToggle')}`);
    expect(selector.queryAll(node => node.props.accessibilityState?.selected)).toHaveLength(0);
});

test('step rows reduce from eight to two columns for accessibility text', async () => {
    const doc = docWithVelocities();
    await act(async () => root.render(<StepGrid doc={doc} pad="kick" current={null} onToggle={jest.fn()} layout="regular" />));
    expect(root.container.queryAll(node => String(node.props.testID ?? '').startsWith('step-row-'))).toHaveLength(2);
    await act(async () => root.render(<StepGrid doc={doc} pad="kick" current={null} onToggle={jest.fn()} layout="compact" />));
    expect(root.container.queryAll(node => String(node.props.testID ?? '').startsWith('step-row-'))).toHaveLength(4);
    await act(async () => root.render(<StepGrid doc={doc} pad="kick" current={null} onToggle={jest.fn()} layout="accessible" />));
    expect(root.container.queryAll(node => String(node.props.testID ?? '').startsWith('step-row-'))).toHaveLength(8);
});
