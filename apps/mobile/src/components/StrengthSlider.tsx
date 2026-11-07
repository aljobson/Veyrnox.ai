import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { colors } from '../theme';

const STEP = 0.1;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

export interface StrengthSliderProps { value: number; label: string; disabled?: boolean; onChange: (value: number) => void }

// An Instagram-style strength line: drag anywhere along it, or use the screen reader's up and down.
export function StrengthSlider({ value, label, disabled, onChange }: StrengthSliderProps) {
    const width = useRef(1);
    // The responder is built once, so it reads the latest props through these.
    const live = useRef({ disabled, onChange });
    live.current = { disabled, onChange };
    const [active, setActive] = useState(false);
    const move = (x: number) => { if (!live.current.disabled) live.current.onChange(clamp(x / width.current)); };
    const responder = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => !live.current.disabled,
        onMoveShouldSetPanResponder: () => !live.current.disabled,
        onPanResponderGrant: event => { setActive(true); move(event.nativeEvent.locationX); },
        onPanResponderMove: event => move(event.nativeEvent.locationX),
        onPanResponderRelease: () => setActive(false),
        onPanResponderTerminate: () => setActive(false),
    })).current;
    const percent = Math.round(value * 100);
    return (
        <View
            accessible accessibilityRole="adjustable" accessibilityLabel={label}
            accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
            accessibilityState={{ disabled: !!disabled }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={event => { if (!disabled) onChange(clamp(value + (event.nativeEvent.actionName === 'increment' ? STEP : -STEP))); }}
            style={styles.wrap}
        >
            <Text style={styles.value}>{percent}</Text>
            <View style={styles.hit} onLayout={(e: LayoutChangeEvent) => { width.current = Math.max(1, e.nativeEvent.layout.width); }} {...responder.panHandlers}>
                <View style={styles.track} pointerEvents="none">
                    <View style={[styles.fill, { width: `${percent}%` }]} />
                </View>
                <View pointerEvents="none" style={[styles.thumb, active && styles.thumbActive, { left: `${percent}%` }]} />
            </View>
        </View>
    );
}
const styles = StyleSheet.create({
    wrap: { alignItems: 'center', gap: 4, paddingHorizontal: 24 },
    value: { color: '#fff', fontSize: 13, fontWeight: '700' },
    hit: { alignSelf: 'stretch', height: 44, justifyContent: 'center' },
    track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
    fill: { height: 3, backgroundColor: '#fff' },
    thumb: { position: 'absolute', width: 22, height: 22, marginLeft: -11, borderRadius: 11, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
    thumbActive: { transform: [{ scale: 1.2 }] },
});
