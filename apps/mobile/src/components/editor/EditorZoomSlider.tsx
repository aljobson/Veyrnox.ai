import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { studioColors as colors } from '../../theme';

export function EditorZoomSlider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange(value: number): void }) {
    const width = useRef(96), latest = useRef({ value, min, max, onChange });
    latest.current = { value, min, max, onChange };
    const update = (x: number) => {
        const current = latest.current, fraction = Math.max(0, Math.min(1, x / Math.max(1, width.current)));
        const next = current.min * ((current.max / current.min) ** fraction);
        current.onChange(Math.max(current.min, Math.min(current.max, next)));
    };
    const [responder] = useState(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => update(event.nativeEvent.locationX),
        onPanResponderMove: event => update(event.nativeEvent.locationX),
    }));
    const percent = Math.max(0, Math.min(100, Math.log(value / min) / Math.log(max / min) * 100));
    return <View {...responder.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Timeline zoom"
        accessibilityValue={{ min, max, now: value, text: `${Math.round(value * 100)}%` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === 'increment') onChange(Math.min(max, value * 1.25));
            if (event.nativeEvent.actionName === 'decrement') onChange(Math.max(min, value / 1.25));
        }}
        onLayout={event => { width.current = event.nativeEvent.layout.width; }} style={local.touch}>
        <View pointerEvents="none" style={local.rail} />
        <View pointerEvents="none" style={[local.progress, { width: `${percent}%` }]} />
        <View pointerEvents="none" style={[local.thumb, { left: `${percent}%` }]} />
    </View>;
}

const local = StyleSheet.create({
    touch: { width: 104, height: 44, justifyContent: 'center', marginHorizontal: -4 },
    rail: { height: 4, borderRadius: 2, backgroundColor: '#303034' },
    progress: { position: 'absolute', start: 0, height: 4, borderRadius: 2, backgroundColor: colors.accent },
    thumb: { position: 'absolute', width: 22, height: 22, marginStart: -11, borderRadius: 11, backgroundColor: '#FFFFFF' },
});
