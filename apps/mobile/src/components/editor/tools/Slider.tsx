import { useEffect, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors, ds, type } from '../../../theme';
import { touchTarget } from '../../../lib/a11y';
import { rawText } from '../../../lib/i18n/translate';
import { sliderValue, stepValue } from './sliderMath';
export type SliderProps = {
    label: string; value: number; min: number; max: number; step: number; snaps?: number[];
    format(value: number): string; disabled?: boolean; onChange(value: number): void;
};
export function Slider(props: SliderProps) {
    const { label, value, min, max, step, format, onChange } = props;
    const disabled = !!props.disabled || min >= max;
    const [live, setLive] = useState(value);
    const current = useRef(props); current.current = { ...props, disabled };
    const width = useRef(0), dragged = useRef(value), origin = useRef(0), active = useRef(false), lastDx = useRef(0);
    useEffect(() => { if (!active.current) { setLive(value); dragged.current = value; } }, [value]);
    const [responder] = useState(() => PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => !current.current.disabled && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (event, gesture) => {
            const p = current.current;
            if (p.disabled) return;
            active.current = true; lastDx.current = gesture.dx; origin.current = event.nativeEvent.locationX - gesture.dx;
            dragged.current = sliderValue(event.nativeEvent.locationX, width.current, p.min, p.max, p.step, p.snaps, p.step,
                { value: p.value, delta: gesture.dx });
            setLive(dragged.current);
        },
        onPanResponderMove: (_, gesture) => {
            const p = current.current;
            if (!active.current || p.disabled) return;
            dragged.current = sliderValue(origin.current + gesture.dx, width.current, p.min, p.max, p.step, p.snaps, p.step,
                { value: dragged.current, delta: gesture.dx - lastDx.current });
            lastDx.current = gesture.dx; setLive(dragged.current);
        },
        onPanResponderTerminationRequest: () => !active.current,
        onPanResponderRelease: () => {
            if (active.current && !current.current.disabled) current.current.onChange(dragged.current);
            active.current = false; setLive(current.current.value);
        },
        onPanResponderTerminate: () => { active.current = false; setLive(current.current.value); },
    }));
    const percent = max > min ? Math.max(0, Math.min(100, (live - min) / (max - min) * 100)) : 0;
    return <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{format(live)}</Text>
        <View {...responder.panHandlers} onLayout={event => { width.current = event.nativeEvent.layout.width; }}
            accessibilityRole="adjustable" accessibilityLabel={rawText(label)} accessibilityState={{ disabled }}
            accessibilityValue={{ min, max, now: live, text: rawText(format(live)) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={event => {
                const name = event.nativeEvent.actionName;
                if (!disabled && (name === 'increment' || name === 'decrement')) onChange(stepValue(value, name === 'increment' ? 1 : -1, min, max, step));
            }} style={[touchTarget, styles.track, disabled && styles.disabled]}>
            <View pointerEvents="none" style={styles.rail} />
            <View pointerEvents="none" style={[styles.thumb, { left: `${percent}%` }]} />
        </View>
    </View>;
}
const styles = StyleSheet.create({
    field: { gap: ds.space.xs }, label: { ...type.label, color: colors.text }, value: { ...type.body, color: colors.text },
    track: { justifyContent: 'center', marginHorizontal: ds.space.sm }, rail: { height: 4, backgroundColor: colors.border, borderRadius: 2 },
    thumb: { position: 'absolute', width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: colors.accent },
    disabled: { opacity: .4 },
});
