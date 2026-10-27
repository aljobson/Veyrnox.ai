import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';
import { onCelebrate, type CelebrationEvent } from '../lib/veyMotion';
import { subscribeCacheUser } from '../lib/appCache';
import { playSuccess } from '../lib/haptics';
import { t } from '../lib/i18n';
import { ds, tokensForScheme } from '../theme';
import { Text, useAppearance, themedStyles, useThemedStyles } from './ui';
import { useReducedMotion } from './ui/useReducedMotion';
import { VeyCharacter } from './VeyCharacter';

export const CELEBRATION_MS = 2600;
const PIECES = Array.from({ length: 80 }, (_, i) => ({
    x: (i + 0.5) / 80,
    drift: Math.sin(i * 2.4) * 24,
    spin: (i % 2 ? 1 : -1) * (180 + i * 11),
    delay: ((i * 17) % 80) / 79 * 400,
}));
export function CelebrationHost() {
    const [event, setEvent] = useState<CelebrationEvent | null>(null);
    const [clapping, setClapping] = useState(false);
    const active = useRef<CelebrationEvent | null>(null);
    const queue = useRef<CelebrationEvent[]>([]);
    const acknowledged = useRef<CelebrationEvent | null>(null);
    const reduced = useReducedMotion();
    const styles = useThemedStyles(sheets);
    const pathname = usePathname();
    const dismiss = useCallback(() => {
        const old = active.current;
        active.current = queue.current.shift() ?? null;
        setEvent(active.current);
        setClapping(false);
        old?.onDone();
    }, []);
    const clear = useCallback(() => {
        const all = [active.current, ...queue.current];
        active.current = null;
        queue.current = [];
        setEvent(null);
        all.forEach((item) => item?.onDone());
    }, []);
    useEffect(() => {
        const off = onCelebrate((next) => {
            if (active.current) queue.current.push(next);
            else {
                active.current = next;
                setEvent(next);
                setClapping(false);
            }
        });
        const offUser = subscribeCacheUser(clear);
        return () => {
            off();
            offUser();
            clear();
        };
    }, [clear]);
    useEffect(() => clear, [pathname, clear]);
    const acknowledge = useCallback(() => {
        if (!event || active.current !== event || acknowledged.current === event) return;
        acknowledged.current = event;
        event.onShown();
        AccessibilityInfo.announceForAccessibility(t(`appearance.${event.kind}`));
        void playSuccess();
    }, [event]);
    useEffect(() => {
        if (!event) return;
        const clap = setTimeout(() => setClapping(true), 500);
        const finish = setTimeout(dismiss, CELEBRATION_MS);
        return () => {
            clearTimeout(clap);
            clearTimeout(finish);
        };
    }, [event, dismiss]);
    if (!event) return null;
    return (
        <Modal transparent visible animationType="none" onRequestClose={dismiss} onShow={acknowledge}>
            <Pressable style={styles.overlay} accessibilityRole="button" accessibilityLabel={t('appearance.dismissCelebration')} onPress={dismiss}>
                {!reduced ? <Confetti key={event.kind} /> : null}
                <View pointerEvents="none" style={styles.message}>
                    <VeyCharacter width={180} mood={reduced ? 'cheer' : clapping ? 'clap' : 'cheer'} />
                    <Text variant="title2" accessibilityRole="header" style={styles.title}>
                        {t(`appearance.${event.kind}`)}
                    </Text>
                </View>
            </Pressable>
        </Modal>
    );
}
export const Confetti = memo(function Confetti() {
    const { width, height } = useWindowDimensions();
    const { settings, scheme } = useAppearance();
    const p = tokensForScheme(scheme, settings);
    const palette = [p.accent, p.accentSubtle, p.warning, p.iris, p.rose];
    const [progress] = useState(() => new Animated.Value(0));
    useEffect(() => {
        // One native clock keeps the last launch, final fade and host dismissal aligned.
        const animation = Animated.timing(progress, { toValue: 1, duration: CELEBRATION_MS, easing: Easing.linear, useNativeDriver: true });
        animation.start();
        return () => animation.stop();
    }, [progress]);
    return (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
            {PIECES.map((piece, i) => (
                <Animated.View
                    key={i}
                    testID="confetti-piece"
                    style={[
                        confetti.piece,
                        {
                            left: piece.x * (width - 7),
                            backgroundColor: palette[i % palette.length],
                            opacity: progress.interpolate({ inputRange: [0, (CELEBRATION_MS - 600) / CELEBRATION_MS, 1], outputRange: [1, 1, 0] }),
                            transform: [
                                { translateX: progress.interpolate({ inputRange: [piece.delay / CELEBRATION_MS, 1], outputRange: [0, piece.drift], extrapolate: 'clamp' }) },
                                {
                                    translateY: progress.interpolate({
                                        inputRange: [piece.delay / CELEBRATION_MS, (piece.delay / CELEBRATION_MS + 1) / 2, 1],
                                        outputRange: [0, (height + 48) * 0.4, height + 48],
                                        extrapolate: 'clamp',
                                    }),
                                },
                                { rotate: progress.interpolate({ inputRange: [piece.delay / CELEBRATION_MS, 1], outputRange: ['0deg', `${piece.spin}deg`], extrapolate: 'clamp' }) },
                            ],
                        },
                    ]}
                />
            ))}
        </View>
    );
});
const confetti = StyleSheet.create({ piece: { position: 'absolute', top: -24, width: 7, height: 12, borderRadius: 2 } });
const sheets = themedStyles((p) => ({
    overlay: { flex: 1, backgroundColor: p.scrim, alignItems: 'center', justifyContent: 'center' },
    message: { alignItems: 'center', gap: ds.space.lg, padding: ds.space.xxl, borderRadius: ds.radius.xl, backgroundColor: p.bgElevated1, margin: ds.space.gutter },
    title: { textAlign: 'center' },
}));
