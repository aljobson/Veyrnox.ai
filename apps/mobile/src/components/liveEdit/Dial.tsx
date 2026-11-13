import { useMemo, useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ds } from '../../theme';
import { Text } from '../ui';
import { themedStyles, useThemedStyles } from '../ui/AppearanceContext';
import { RULER, SPACING, TICKS, crossedStep, isMajorTick, nudge, offsetFor, percentOf, valueAfterDrag } from '../../lib/liveEdit/dial';

export interface DialProps { value: number; label: string; disabled?: boolean; onChange: (value: number) => void; onChangeStart?: () => void; onChangeEnd?: () => void }

// The ruler slides under a fixed needle, with a tick of haptics every 5%. Drag left to raise the value.
export function Dial({ value, label, disabled, onChange, onChangeStart, onChangeEnd }: DialProps) {
    const s = useThemedStyles(sheets);
    const [width, setWidth] = useState(0);
    const live = useRef({ value, disabled, onChange, onChangeStart, onChangeEnd });
    live.current = { value, disabled, onChange, onChangeStart, onChangeEnd };
    const gesture = useRef({ start: 0, last: 0 });
    const responder = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => !live.current.disabled,
        onMoveShouldSetPanResponder: () => !live.current.disabled,
        onPanResponderGrant: () => { gesture.current = { start: live.current.value, last: live.current.value }; live.current.onChangeStart?.(); },
        onPanResponderMove: (_event, state) => {
            const next = valueAfterDrag(gesture.current.start, state.dx);
            if (crossedStep(gesture.current.last, next)) { try { void Haptics.selectionAsync(); } catch { /* haptics are a nicety */ } }
            gesture.current.last = next;
            live.current.onChange(next);
        },
        onPanResponderRelease: () => live.current.onChangeEnd?.(),
        onPanResponderTerminate: () => live.current.onChangeEnd?.(),
    })).current;
    const ticks = useMemo(() => Array.from({ length: TICKS + 1 }, (_, index) => index), []);
    const percent = percentOf(value);
    return (
        <View
            accessible accessibilityRole="adjustable" accessibilityLabel={label}
            accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
            accessibilityState={{ disabled: !!disabled }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={event => { if (!disabled) { onChangeStart?.(); onChange(nudge(value, event.nativeEvent.actionName === 'increment' ? 'increment' : 'decrement')); onChangeEnd?.(); } }}
            style={[s.wrap, disabled && s.off]}
        >
            <Text variant="bodyStrong" accessible={false}>{percent}</Text>
            <View style={s.window} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers}>
                <View pointerEvents="none" style={[s.ruler, { width: RULER + 1, transform: [{ translateX: offsetFor(value, width) }] }]}>
                    {ticks.map(index => <View key={index} style={[s.tick, isMajorTick(index) ? s.major : s.minor, { left: index * SPACING }]} />)}
                </View>
                <View pointerEvents="none" style={s.needle} />
            </View>
        </View>
    );
}
const sheets = themedStyles(p => ({
    wrap: { alignItems: 'center', gap: ds.space.xs },
    off: { opacity: 0.4 },
    window: { alignSelf: 'stretch', height: 44, overflow: 'hidden', justifyContent: 'center' },
    ruler: { height: 44 },
    tick: { position: 'absolute', width: 2, borderRadius: 1, backgroundColor: p.borderStrong, top: 14 },
    major: { height: 16 },
    minor: { height: 10, top: 17 },
    needle: { position: 'absolute', left: '50%', marginLeft: -1, top: 6, width: 2, height: 32, borderRadius: 1, backgroundColor: p.accent },
}));
