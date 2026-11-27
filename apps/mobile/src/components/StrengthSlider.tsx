import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { colors } from '../theme';
import { themedStyles, useThemedStyles } from './ui/AppearanceContext';
import { useReducedMotion } from './ui/useReducedMotion';

const DEFAULT_STEP = 0.1;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

export interface StrengthSliderProps {
    testID?: string;
    value: number;
    valueText?: string;
    displayValue?: number;
    valueRange?: { min: number; max: number; now: number };
    tone?: 'media' | 'surface';
    compact?: boolean;
    /** Keep a horizontal drag inside this slider instead of yielding to a parent scroller. */
    lockGesture?: boolean;
    label: string;
    accessibilityHint?: string;
    disabled?: boolean;
    step?: number;
    onChange: (value: number) => void;
    onChangeStart?: () => void;
    onChangeEnd?: () => void;
}

// An Instagram-style strength line: drag anywhere along it, or use the screen reader's up and down.
export function StrengthSlider({ testID, value, valueText, displayValue, valueRange, label, accessibilityHint, disabled, step = DEFAULT_STEP, onChange, onChangeStart, onChangeEnd, tone = 'media', compact = false, lockGesture = false }: StrengthSliderProps) {
    const themed = useThemedStyles(sheets);
    const reduced = useReducedMotion();
    const surface = tone === 'surface';
    const width = useRef(1);
    // The responder is built once, so it reads the latest props through these.
    const live = useRef({ disabled, onChange, onChangeStart, onChangeEnd, lockGesture });
    live.current = { disabled, onChange, onChangeStart, onChangeEnd, lockGesture };
    const [active, setActive] = useState(false);
    const accessibilityStep = Number.isFinite(step) && step > 0 ? step : DEFAULT_STEP;
    const move = (x: number) => { if (!live.current.disabled) live.current.onChange(clamp(x / width.current)); };
    const responder = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => !live.current.disabled,
        onMoveShouldSetPanResponder: () => !live.current.disabled,
        onPanResponderGrant: event => { live.current.onChangeStart?.(); setActive(true); move(event.nativeEvent.locationX); },
        onPanResponderMove: event => move(event.nativeEvent.locationX),
        onPanResponderTerminationRequest: () => !live.current.lockGesture,
        // Preserve the slider's Android responder behaviour for every caller.
        // `lockGesture` only prevents a parent scroll view from terminating an
        // active drag; it must not change native responder blocking elsewhere.
        onShouldBlockNativeResponder: () => true,
        onPanResponderRelease: () => { setActive(false); live.current.onChangeEnd?.(); },
        onPanResponderTerminate: () => { setActive(false); live.current.onChangeEnd?.(); },
    })).current;
    const percent = Math.round(value * 100);
    return (
        <View
            testID={testID}
            accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityHint={accessibilityHint}
            accessibilityValue={{ min: valueRange?.min ?? 0, max: valueRange?.max ?? 100, now: valueRange?.now ?? percent, text: valueText ?? `${percent}%` }}
            accessibilityState={{ disabled: !!disabled }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={event => { if (!disabled) { onChangeStart?.();
                onChange(clamp(Math.round((value + (event.nativeEvent.actionName === 'increment' ? accessibilityStep : -accessibilityStep)) * 10000) / 10000)); onChangeEnd?.(); } }}
            style={[styles.wrap, compact && styles.wrapCompact]}
        >
            <Text testID={testID ? `${testID}-value` : 'strength-slider-value'} style={[styles.value, surface && themed.value]}>{displayValue ?? percent}</Text>
            <View style={[styles.hit, compact && styles.hitCompact]} onLayout={(e: LayoutChangeEvent) => { width.current = Math.max(1, e.nativeEvent.layout.width); }} {...responder.panHandlers}>
                <View style={[styles.track, surface && themed.track]} pointerEvents="none">
                    <View style={[styles.fill, surface && themed.fill, { width: `${percent}%` }]} />
                </View>
                <View pointerEvents="none" style={[styles.thumb, surface && themed.thumb, active && !reduced && styles.thumbActive, { left: `${percent}%` }]} />
            </View>
        </View>
    );
}
const styles = StyleSheet.create({
    wrap: { alignItems: 'center', gap: 4, paddingHorizontal: 24 },
    wrapCompact: { minHeight: 44, flexDirection: 'row', gap: 6, paddingHorizontal: 8 },
    value: { color: '#fff', fontSize: 13, fontWeight: '700' },
    hit: { alignSelf: 'stretch', height: 44, justifyContent: 'center' },
    hitCompact: { flex: 1, alignSelf: 'auto' },
    track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
    fill: { height: 3, backgroundColor: '#fff' },
    thumb: { position: 'absolute', width: 22, height: 22, marginLeft: -11, borderRadius: 11, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
    thumbActive: { transform: [{ scale: 1.2 }] },
});

const sheets = themedStyles(p => ({ value: { color: p.textPrimary }, track: { backgroundColor: p.borderStrong }, fill: { backgroundColor: p.accent }, thumb: { backgroundColor: p.accent, borderColor: p.borderStrong } }));
