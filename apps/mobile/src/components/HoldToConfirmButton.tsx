import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View, type AccessibilityActionEvent } from 'react-native';
import { ds } from '../theme';
import { playSuccess } from '../lib/haptics';
import { Text } from './ui/Text';
import { themedStyles, useThemedStyles } from './ui/AppearanceContext';

export const HOLD_MS = 1600;
const ROLLBACK_MS = 220;
// A press shorter than this is a tap, not an attempt to hold.
const TAP_MS = 250;

export interface HoldToConfirmButtonProps {
    label: string;
    hint: string;
    disabled?: boolean;
    onConfirm: () => void;
    // A tap instead of a hold: the screen says how to use the button.
    onTap?: () => void;
    // Screen readers cannot hold, so their "activate" takes this path (a confirmation dialog).
    onAccessibilityActivate: () => void;
}

// Press and hold to confirm a destructive action. Letting go early rolls the fill back and nothing happens.
export function HoldToConfirmButton({ label, hint, disabled, onConfirm, onTap, onAccessibilityActivate }: HoldToConfirmButtonProps) {
    const s = useThemedStyles(sheets);
    const progress = useRef(new Animated.Value(0)).current;
    const pressedAt = useRef(0);
    const done = useRef(false);
    useEffect(() => () => progress.stopAnimation(), [progress]);

    function start() {
        if (disabled) return;
        done.current = false;
        pressedAt.current = Date.now();
        Animated.timing(progress, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => {
            if (!finished) return;
            done.current = true;
            void playSuccess();
            onConfirm();
            progress.setValue(0);
        });
    }
    function release() {
        if (done.current || disabled) return;
        progress.stopAnimation();
        Animated.timing(progress, { toValue: 0, duration: ROLLBACK_MS, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
        if (Date.now() - pressedAt.current < TAP_MS) onTap?.();
    }
    function onAccessibilityAction(event: AccessibilityActionEvent) {
        if (event.nativeEvent.actionName === 'activate' && !disabled) onAccessibilityActivate();
    }
    const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={hint}
            accessibilityState={{ disabled: !!disabled }}
            accessibilityActions={[{ name: 'activate' }]}
            onAccessibilityAction={onAccessibilityAction}
            disabled={disabled}
            onPressIn={start}
            onPressOut={release}
            style={[s.base, disabled && s.disabled]}
            testID="hold-to-confirm"
        >
            <Animated.View pointerEvents="none" style={[s.fill, { width }]} />
            <View pointerEvents="none" style={s.labelRow}>
                <Text variant="bodyStrong" style={s.ink}>{label}</Text>
            </View>
        </Pressable>
    );
}

const sheets = themedStyles((p) => ({
    base: { minHeight: 52, borderRadius: ds.radius.md, borderWidth: 1, borderColor: p.danger, overflow: 'hidden', justifyContent: 'center' },
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: p.danger, opacity: 0.24 },
    labelRow: { alignItems: 'center', paddingHorizontal: ds.space.lg },
    ink: { color: p.danger },
    disabled: { opacity: 0.5 },
}));
