import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, I18nManager, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandGlow } from './BrandGlow';
import { EASE_OUT } from '../lib/motionCurves';
import { MIN_TARGET, touchTarget } from '../lib/a11y';
import { rawText } from '../lib/i18n/translate';
import { t } from '../lib/i18n';
import { ds } from '../theme';
import { Icon, Text, themedStyles, useThemedStyles } from './ui';
import { useReducedMotion } from './ui/useReducedMotion';

interface Props {
    // 1-based position in the whole first-run journey, and how many steps it has: one bar across welcome and questions.
    step: number;
    total: number;
    onBack?: () => void;
    onSkip?: () => void;
    skipLabel?: string;
    backLabel?: string;
    footer: ReactNode;
    children: ReactNode;
}

// The frame every first-run screen shares: a progress bar that fills as you go, Back and Skip in the corners, a soft accent
// glow behind the content and the primary action pinned to the bottom. Reduce Motion fills the bar without easing.
export function OnboardingShell({ step, total, onBack, onSkip, skipLabel, backLabel, footer, children }: Props) {
    const insets = useSafeAreaInsets();
    const s = useThemedStyles(sheets);
    const reduced = useReducedMotion();
    const fill = useRef(new Animated.Value(step / total)).current;
    useEffect(() => {
        Animated.timing(fill, { toValue: step / total, duration: reduced ? 0 : ds.motion.sheet, easing: EASE_OUT, useNativeDriver: true }).start();
    }, [fill, reduced, step, total]);
    const label = rawText(t('welcome.step', { n: step, total }));
    return (
        <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={s.glowWrap} pointerEvents="none"><BrandGlow shown reduced={reduced} /></View>
            <View style={s.top}>
                <View style={s.slot}>
                    {onBack ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={rawText(backLabel ?? t('public.vey.back'))} hitSlop={8} onPress={onBack} style={s.back}>
                            <Icon name="arrowLeft" size={20} />
                        </Pressable>
                    ) : null}
                </View>
                <View style={s.track} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step, text: label }}>
                    {/* The bar grows from the start edge, which is the right edge when the language reads right to left. */}
                    <Animated.View style={[s.bar, { transformOrigin: I18nManager.isRTL ? 'right center' : 'left center', transform: [{ scaleX: fill }] }]} />
                </View>
                <View style={s.slot}>
                    {onSkip ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={rawText(skipLabel ?? t('welcome.skip'))} hitSlop={8} onPress={onSkip} style={[touchTarget, s.skip]}>
                            <Text variant="bodyStrong" tone="secondary" numberOfLines={1}>{skipLabel ?? t('welcome.skip')}</Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>
            <View style={s.body}>{children}</View>
            <View style={s.footer}>{footer}</View>
        </View>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    glowWrap: { position: 'absolute', top: -120, left: 0, right: 0, alignItems: 'center' },
    top: { flexDirection: 'row', alignItems: 'center', gap: ds.space.md, paddingHorizontal: ds.space.gutter, paddingTop: ds.space.md },
    slot: { minWidth: MIN_TARGET, minHeight: MIN_TARGET, maxWidth: '34%', flexShrink: 0, justifyContent: 'center' },
    back: { width: MIN_TARGET, height: MIN_TARGET, borderRadius: MIN_TARGET / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface },
    skip: { alignItems: 'flex-end' },
    track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: p.borderSubtle, overflow: 'hidden' },
    // Full width, shrunk by scaleX from the start edge (set at render, for RTL), so only the transform animates.
    bar: { height: 6, borderRadius: 3, backgroundColor: p.accent },
    body: { flex: 1, paddingHorizontal: ds.space.gutter },
    footer: { paddingHorizontal: ds.space.gutter, paddingVertical: ds.space.lg, gap: ds.space.sm },
}));
