import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatPatternControls } from '../src/components/beats/BeatPatternControls';
import { t } from '../src/lib/i18n';

void [RN.View, RN.Text, RN.Pressable, RN.Modal, RN.ScrollView];
let root: Root;
const props = {
    pattern: 'A' as const, uses: 3, swing: 0.3, metronome: false, steps: 16 as const,
    disabled: false, clearDisabled: false, onSwing: jest.fn(), onMetronome: jest.fn(),
    onSteps: jest.fn(), onCopy: jest.fn(), onClear: jest.fn(), onClose: jest.fn(), onDismiss: jest.fn(),
};
const node = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('shows the complete pattern contract with explicit states and 44pt actions', async () => {
    await act(async () => root.render(<BeatPatternControls {...props} />));
    expect(root.container.queryAll(n => n.children.includes(t('beat.pattern.usage', { pattern: 'A', count: 3 })))).toHaveLength(1);
    const metro = node(t('beat.pattern.metronome'));
    expect(metro.props.accessibilityRole).toBe('switch');
    expect(metro.props.accessibilityState.checked).toBe(false);
    expect(root.container.queryAll(n => n.props.testID === 'beat-pattern-metronome-off')).toHaveLength(1);
    await act(async () => (metro.props.onClick ?? metro.props.onPress)({ nativeEvent: {} }));
    expect(props.onMetronome).toHaveBeenCalledWith(true);
    await act(async () => root.render(<BeatPatternControls {...props} metronome />));
    expect(root.container.queryAll(n => n.props.testID === 'beat-pattern-metronome-on' && n.children.some(child => String(child).includes('✓')))).toHaveLength(1);
    for (const target of ['B', 'C', 'D'] as const) expect(node(t('beat.pattern.copy', { from: 'A', to: target }))).toBeDefined();
    expect(node(t('beat.pattern.clear', { pattern: 'A' })).props.accessibilityState.disabled).toBe(false);
    const interactive = root.container.queryAll(n => ['button', 'tab', 'switch', 'adjustable'].includes(n.props.accessibilityRole) && typeof (n.props.onClick ?? n.props.onPress ?? n.props.onAccessibilityAction) === 'function');
    for (const control of interactive.filter(n => n.props.accessibilityRole === 'button')) {
        expect(RN.StyleSheet.flatten(control.props.style)?.minHeight ?? 44).toBeGreaterThanOrEqual(44);
    }
});

test('swing moves by exactly one percentage point and length emits a typed step count', async () => {
    await act(async () => root.render(<BeatPatternControls {...props} />));
    const swing = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === t('beat.pattern.swing'))[0];
    expect(swing.props.accessibilityValue.text).toBe('30%');
    expect(swing.props.accessibilityValue).toMatchObject({ min: 0, max: 60, now: 30 });
    expect(swing.queryAll(n => n.props.testID === 'strength-slider-value' && n.children.some(child => String(child) === '30'))).toHaveLength(1);
    expect(swing.queryAll(n => n.props.testID === 'strength-slider-value' && n.children.some(child => String(child) === '50'))).toHaveLength(0);
    await act(async () => swing.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(props.onSwing).toHaveBeenCalledWith(0.31);
    const length = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityLabel === t('beat.pattern.length32'))[0];
    await act(async () => (length.props.onClick ?? length.props.onPress)({ nativeEvent: {} }));
    expect(props.onSteps).toHaveBeenCalledWith(32);
});

test('lock and empty state disable every mutation while close stays available', async () => {
    await act(async () => root.render(<BeatPatternControls {...props} disabled clearDisabled />));
    const mutations = root.container.queryAll(n => n.props.accessibilityLabel !== t('beat.pattern.close') &&
        ['button', 'tab', 'switch', 'adjustable'].includes(n.props.accessibilityRole));
    expect(mutations.length).toBeGreaterThan(0);
    for (const control of mutations) expect(control.props.accessibilityState?.disabled).toBe(true);
    expect(node(t('beat.pattern.close')).props.accessibilityState.disabled).toBe(false);
});

test('notifies the editor after native dismissal so focus can return to the trigger', async () => {
    await act(async () => root.render(<BeatPatternControls {...props} />));
    const modal = root.container.queryAll(n => n.props.onDismiss === props.onDismiss)[0];
    expect(modal).toBeDefined();
    await act(async () => modal.props.onDismiss());
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
});
