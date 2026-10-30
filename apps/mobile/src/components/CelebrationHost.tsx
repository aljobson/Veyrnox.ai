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

// Owner, 2026-10-30: 2.6 s felt too fast; the celebration holds for 5 s (tap to dismiss early).
export const CELEBRATION_MS = 5000;
export const CLAP_MS = 1000;
// Owner, 2026-10-30: the confetti bursts from the mascot like an explosion. Every piece leaves the centre at its own
// angle and speed, decelerates by BURST_END, then tumbles down past the bottom edge. Values are seeded, so tests and
// screenshots are stable.
export const CONFETTI_COUNT = 120;
export const BURST_END = 0.12;
const seeded = (i: number, salt: number) => {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
};
const PIECES = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
    const angle = seeded(i, 1) * Math.PI * 2;
    const speed = 0.35 + seeded(i, 2) * 0.65; // share of the screen's half-diagonal
    const size = 4 + Math.round(seeded(i, 3) * 8);
    return {
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed - 0.25, // the blast throws pieces upward a little
        delay: seeded(i, 4) * 0.03, // a ragged edge to the blast, never a neat ring
        spin: (seeded(i, 5) < 0.5 ? -1 : 1) * (360 + Math.round(seeded(i, 6) * 1080)),
        drift: (seeded(i, 7) - 0.5) * 0.3,
        width: size,
        height: seeded(i, 8) < 0.35 ? size : Math.round(size * 1.8),
        round: seeded(i, 9) < 0.3,
    };
});
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
        const clap = setTimeout(() => setClapping(true), CLAP_MS);
        const finish = setTimeout(dismiss, CELEBRATION_MS);
        return () => {
            clearTimeout(clap);
            clearTimeout(finish);
        };
    }, [event, dismiss]);
    if (!event) return null;
    return (
        <Modal transparent visible animationType="none" onRequestClose={dismiss} onShow={acknowledge}>
            <View style={{ flex: 1 }} onAccessibilityEscape={dismiss}><Pressable style={styles.overlay} accessibilityRole="button" accessibilityLabel={t('appearance.dismissCelebration')} onPress={dismiss}>
                {!reduced ? <Confetti key={event.kind} /> : null}
                <View pointerEvents="none" style={styles.message}>
                    <VeyCharacter width={180} mood={reduced ? 'cheer' : clapping ? 'clap' : 'cheer'} />
                    <Text variant="title2" accessibilityRole="header" style={styles.title}>
                        {t(`appearance.${event.kind}`)}
                    </Text>
                </View>
            </Pressable></View>
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
    const reach = Math.hypot(width, height) / 2;
    const fadeStart = (CELEBRATION_MS - 600) / CELEBRATION_MS;
    return (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
            {PIECES.map((piece, i) => {
                const start = piece.delay;
                const burst = start + BURST_END;
                const bx = piece.dx * reach;
                const by = piece.dy * reach;
                return (
                    <Animated.View
                        key={i}
                        testID="confetti-piece"
                        style={[
                            confetti.piece,
                            {
                                left: width / 2 - piece.width / 2,
                                top: height * 0.42,
                                width: piece.width,
                                height: piece.height,
                                borderRadius: piece.round ? piece.width / 2 : 2,
                                backgroundColor: palette[i % palette.length],
                                opacity: progress.interpolate({ inputRange: [0, fadeStart, 1], outputRange: [1, 1, 0] }),
                                transform: [
                                    {
                                        translateX: progress.interpolate({
                                            inputRange: [start, start + BURST_END * 0.35, burst, 1],
                                            outputRange: [0, bx * 0.75, bx, bx + piece.drift * width],
                                            extrapolate: 'clamp',
                                        }),
                                    },
                                    {
                                        translateY: progress.interpolate({
                                            inputRange: [start, start + BURST_END * 0.35, burst, (burst + 1) / 2, 1],
                                            outputRange: [0, by * 0.75, by, by + height * 0.35, height * 1.2],
                                            extrapolate: 'clamp',
                                        }),
                                    },
                                    { rotate: progress.interpolate({ inputRange: [start, 1], outputRange: ['0deg', `${piece.spin}deg`], extrapolate: 'clamp' }) },
                                    { scale: progress.interpolate({ inputRange: [start, start + BURST_END * 0.35, 1], outputRange: [0.3, 1.15, 0.9], extrapolate: 'clamp' }) },
                                ],
                            },
                        ]}
                    />
                );
            })}
        </View>
    );
});
const confetti = StyleSheet.create({ piece: { position: 'absolute' } });
const sheets = themedStyles((p) => ({
    overlay: { flex: 1, backgroundColor: p.scrim, alignItems: 'center', justifyContent: 'center' },
    message: { alignItems: 'center', gap: ds.space.lg, padding: ds.space.xxl, borderRadius: ds.radius.xl, backgroundColor: p.bgElevated1, margin: ds.space.gutter },
    title: { textAlign: 'center' },
}));
