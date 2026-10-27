import { DisabledTextContext } from './DisabledTextContext';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ds } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';
import { Text } from './Text';
import { Icon } from './Icon';
import { themedStyles, useThemedStyles } from './AppearanceContext';
import { useReducedMotion } from './useReducedMotion';
export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
    label: string;
    children?: ReactNode;
    iconOnly?: boolean;
    containerStyle?: StyleProp<ViewStyle>;
    variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive';
    tone?: 'primary' | 'secondary' | 'accent' | 'danger';
    size?: 'lg' | 'md' | 'sm';
    icon?: MenuIcon;
    loading?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
};
export function Button({ label, variant = 'primary', size = 'lg', tone = 'primary', icon, loading, disabled, style, textStyle, onPress, children, iconOnly, containerStyle, ...props }: ButtonProps) {
    const s = useThemedStyles(sheets);
    const reduced = useReducedMotion();
    const scale = useRef(new Animated.Value(1)).current;
    const blocked = disabled || loading;
    const animatedStyle = useMemo(() => ({ transform: [{ scale }] }), [scale]);
    useEffect(() => () => scale.stopAnimation(), [scale]);
    useEffect(() => {
        if (reduced) {
            scale.stopAnimation();
            scale.setValue(1);
        }
    }, [reduced, scale]);
    const press = (value: number) => {
        if (!reduced) Animated.spring(scale, { toValue: value, speed: 32, bounciness: 0, useNativeDriver: true }).start();
    };
    const ink = blocked && variant === 'primary' ? s.disabledInk : variant === 'primary' ? s.primaryInk : variant === 'destructive' ? s.destructiveInk : s[`${tone}Tone`];
    return (
        <Animated.View style={[s.hit, containerStyle, animatedStyle]}>
            <Pressable
                {...props}
                accessibilityRole={props.accessibilityRole ?? 'button'}
                accessibilityLabel={props.accessibilityLabel ?? label}
                accessibilityState={{ ...props.accessibilityState, disabled: !!blocked, busy: props.accessibilityState?.busy ?? !!loading }}
                disabled={blocked}
                hitSlop={props.hitSlop ?? (size === 'sm' ? 6 : undefined)}
                onPressIn={() => press(ds.motion.pressScale)}
                onPressOut={() => press(1)}
                onPress={(event) => {
                    if (blocked) return;
                    if (variant === 'primary') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    onPress?.(event);
                }}
                style={({ pressed }) => [s.base, s[size], s[variant], pressed && !blocked && s[`${variant}Pressed`], style, blocked && (variant === 'primary' ? s.disabledPrimary : s.disabled)]}
            >
                <DisabledTextContext value={!!blocked && variant === 'primary'}>
                {loading ? (
                    <ActivityIndicator color={ink.color} />
                ) : children ?? (
                    <>
                        {icon ? <Icon name={icon} size={20} tint={ink.color} /> : null}
                        {!iconOnly ? <Text variant="bodyStrong" style={[ink, textStyle, blocked && variant === 'primary' && s.disabledInk]}>
                            {label}
                        </Text> : null}
                    </>
                )}
                </DisabledTextContext>
            </Pressable>
        </Animated.View>
    );
}
const sheets = themedStyles((p) => ({
    hit: { minHeight: 44, justifyContent: 'center' },
    base: { minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: ds.space.sm, borderRadius: ds.radius.md, paddingHorizontal: ds.space.lg },
    lg: { minHeight: 52 },
    md: { minHeight: 44 },
    sm: { minHeight: 32 },
    disabled: { opacity: 0.4 },
    disabledPrimary: { backgroundColor: p.surface },
    disabledInk: { color: p.textTertiary },
    primary: { backgroundColor: p.accent },
    secondary: { backgroundColor: p.surface },
    tertiary: {},
    destructive: { backgroundColor: p.danger },
    primaryPressed: { backgroundColor: p.accentPressed },
    secondaryPressed: { backgroundColor: p.surfacePressed },
    tertiaryPressed: { backgroundColor: p.surface },
    destructivePressed: { opacity: 0.8 },
    primaryInk: { color: p.onAccent },
    destructiveInk: { color: p.bg },
    primaryTone: { color: p.textPrimary },
    secondaryTone: { color: p.textSecondary },
    accentTone: { color: p.accent },
    dangerTone: { color: p.danger },
}));
