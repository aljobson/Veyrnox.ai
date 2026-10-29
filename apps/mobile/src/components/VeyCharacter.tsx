import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { CANVAS, heightFor, pivotStyle } from '../lib/veyCharacter';
import { t as translate } from '../lib/i18n';
import { playSelection } from '../lib/haptics';
import type { VeyMood } from '../lib/veyMotion';

const art = {
    base: require('../../assets/vey/base.png'),
    leftArm: require('../../assets/vey/left-arm.png'),
    rightArm: require('../../assets/vey/right-arm.png'),
    body: require('../../assets/vey/body.png'),
    core: require('../../assets/vey/core.png'),
    head: require('../../assets/vey/head.png'),
    eyes: require('../../assets/vey/eyes.png'),
};

const ease = Easing.inOut(Easing.sin);

// A back-and-forth that never stops: 0 to 1 and back.
function swing(value: Animated.Value, duration: number) {
    return Animated.loop(
        Animated.sequence([
            Animated.timing(value, { toValue: 1, duration, easing: ease, useNativeDriver: true }),
            Animated.timing(value, { toValue: 0, duration, easing: ease, useNativeDriver: true }),
        ]),
    );
}

// The art stays decorative; an optional, separate button carries touch semantics.
export function VeyCharacter({ width = 72, mood = 'idle', interactive = false, onReact }: {
    width?: number; mood?: VeyMood; interactive?: boolean; onReact?: (kind: 'tap' | 'hold') => void;
}) {
    const k = width / CANVAS.width;
    const sway = useRef(new Animated.Value(0.5)).current;
    const wave = useRef(new Animated.Value(0.5)).current;
    const hop = useRef(new Animated.Value(0)).current;
    const cheer = useRef(new Animated.Value(0)).current;
    const tilt = useRef(new Animated.Value(0.5)).current;
    const blink = useRef(new Animated.Value(1)).current;
    const droop = useRef(new Animated.Value(0)).current;
    const clap = useRef(new Animated.Value(0)).current;
    const spin = useRef(new Animated.Value(0)).current;
    const busy = useRef(new Animated.Value(0.5)).current;
    const glow = useRef(new Animated.Value(1)).current;
    const react = useRef<(kind: VeyReaction) => void>(() => {});
    const [still, setStill] = useState(true);

    const gestures = useVeyGestures({ interactive, still, mood, scale: k, react, onReact });

    useEffect(() => {
        let alive = true;
        AccessibilityInfo.isReduceMotionEnabled().then((on) => alive && setStill(on)).catch(() => {});
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
        return () => {
            alive = false;
            sub.remove();
        };
    }, []);

    useEffect(() => {
        const reset = () => {
            sway.setValue(0.5); wave.setValue(0.5); hop.setValue(0); cheer.setValue(0);
            clap.setValue(0); tilt.setValue(0.5); blink.setValue(1); droop.setValue(0);
            spin.setValue(0); busy.setValue(0.5); glow.setValue(1);
        };
        reset();
        if (still) {
            cheer.setValue(mood === 'cheer' || mood === 'clap' || mood === 'wave' ? 1 : 0);
            droop.setValue(0);
            react.current = () => {};
            return reset;
        }
        const t = (v: Animated.Value, toValue: number, duration: number) => Animated.timing(v, { toValue, duration, easing: ease, useNativeDriver: true });
        const hops = () => Animated.sequence([t(hop, 1, 220), t(hop, 0, 260), t(hop, 1, 200), t(hop, 0, 240)]);
        const cheers = () => Animated.sequence([t(cheer, 1, 260), Animated.delay(420), t(cheer, 0, 300)]);
        const waves = () => Animated.sequence([
            ...Array.from({ length: 3 }, () => Animated.sequence([t(wave, 0, 180), t(wave, 1, 180)])),
            t(wave, 0.5, 180),
        ]);
        let animations: Animated.CompositeAnimation[] = [];
        let disposed = false;
        let reacting = false;
        let queued: VeyReaction | null = null;
        let waved = false;
        const stop = () => { animations.forEach((animation) => animation.stop()); animations = []; reset(); };
        const startMood = () => {
            const current = mood === 'wave' ? 'idle' : mood;
            animations = [Animated.loop(Animated.sequence([
                Animated.delay(2400), t(blink, 0.12, 70), t(blink, 1, 90), Animated.delay(2000),
            ]))];
            if (current === 'working') {
                // Alternating small arm movements and a faster core, without any hops or body bob.
                animations.push(swing(busy, 360), swing(glow, 440));
            } else {
                if (current !== 'clap') animations.push(swing(sway, 1100));
                if (current !== 'worried' && current !== 'clap') animations.push(swing(wave, 520));
            }
            if (current === 'clap') animations.push(Animated.sequence([
                ...Array.from({ length: 3 }, () => Animated.sequence([t(clap, 1, 90), t(clap, 0, 90)])), t(cheer, 1, 180),
            ]));
            if (current === 'idle') animations.push(Animated.loop(Animated.sequence([
                Animated.delay(1800), Animated.parallel([hops(), cheers()]), Animated.delay(1600),
                t(tilt, 0, 380), Animated.delay(500), t(tilt, 1, 520), Animated.delay(400), t(tilt, 0.5, 380),
            ])));
            if (current === 'hop') animations.push(Animated.parallel([hops(), cheers()]));
            if (current === 'cheer') animations.push(Animated.loop(Animated.parallel([hops(), cheers()])));
            animations.push(t(droop, current === 'worried' ? 1 : 0, 320));
            if (mood === 'wave' && !waved) {
                waved = true;
                animations = [waves()];
                animations[0].start(({ finished }) => { if (finished && !disposed && !reacting) { reset(); startMood(); } });
            } else animations.forEach((animation) => animation.start());
        };
        const reaction = (kind: VeyReaction) => {
            if (reacting) {
                // A single pending slot; preserve the earned giggle over later ordinary taps.
                if (queued !== 'giggle') queued = kind;
                return;
            }
            reacting = true;
            stop();
            const animation = kind === 'hold' ? waves() : kind === 'giggle' ? t(spin, 1, 720)
                : Animated.parallel([hops(), Animated.sequence([t(tilt, 1, 180), t(tilt, 0.5, 300)])]);
            animations = [animation];
            animation.start(({ finished }) => {
                if (!finished || disposed) return;
                reset(); reacting = false;
                const next = queued; queued = null;
                if (next) reaction(next); else startMood();
            });
        };
        react.current = reaction;
        startMood();
        return () => { disposed = true; queued = null; react.current = () => {}; stop(); };
    }, [still, mood, sway, wave, hop, cheer, tilt, blink, droop, clap, spin, busy, glow]);

    const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    const hopY = hop.interpolate({ inputRange: [0, 1], outputRange: [0, -8 * k] });
    const lift = (value: Animated.Value, by: number) => value.interpolate({ inputRange: [0, 1], outputRange: [0, -by * k] });

    const styles = useMemo(() => layerStyles(width), [width]);
    const horizontalSlop = Math.max(0, (44 - width) / 2);
    const verticalSlop = Math.max(0, (44 - heightFor(width)) / 2);

    const leftArm = <Animated.Image source={art.leftArm} style={[styles.layer, pivotStyle('leftArm', width), { transform: [{ translateX: clap.interpolate({ inputRange: [0, 1], outputRange: [0, 18 * k] }) }, { translateY: Animated.add(clap.interpolate({ inputRange: [0, 1], outputRange: [0, -16 * k] }), busy.interpolate({ inputRange: [0, 1], outputRange: [-2 * k, 2 * k] })) }, { rotate: Animated.add(clap.interpolate({ inputRange: [0, 1], outputRange: [0, -95] }), Animated.add(Animated.add(busy.interpolate({ inputRange: [0, 1], outputRange: [-12, 12] }), sway.interpolate({ inputRange: [0, 1], outputRange: [28, -28] })), cheer.interpolate({ inputRange: [0, 1], outputRange: [0, -70] }))).interpolate({ inputRange: [-120, 120], outputRange: ['-120deg', '120deg'] }) }, { translateY: hopY }] }]} />;
    const rightArm = <Animated.Image source={art.rightArm} style={[styles.layer, pivotStyle('rightArm', width), { transform: [{ translateX: clap.interpolate({ inputRange: [0, 1], outputRange: [0, -30 * k] }) }, { translateY: Animated.add(clap.interpolate({ inputRange: [0, 1], outputRange: [0, 10 * k] }), busy.interpolate({ inputRange: [0, 1], outputRange: [2 * k, -2 * k] })) }, { rotate: Animated.add(clap.interpolate({ inputRange: [0, 1], outputRange: [0, 95] }), Animated.add(Animated.add(busy.interpolate({ inputRange: [0, 1], outputRange: [-12, 12] }), wave.interpolate({ inputRange: [0, 1], outputRange: [38, -48] })), cheer.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }))).interpolate({ inputRange: [-120, 120], outputRange: ['-120deg', '120deg'] }) }, { translateY: hopY }] }]} />;

    const picture = (
        <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
            <Animated.Image source={art.base} style={styles.layer} />
            {mood === 'clap' ? null : <>{leftArm}{rightArm}</>}
            <Animated.Image source={art.body} style={[styles.layer, { transform: [{ rotate: rotation }, { translateY: Animated.add(lift(sway, 3), hopY) }] }]} />
            <Animated.Image source={art.core} style={[styles.layer, pivotStyle('core', width), { opacity: Animated.multiply(mood === 'working' ? glow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) : sway.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }), droop.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] })), transform: [{ rotate: rotation }, { translateY: Animated.add(lift(sway, 3), hopY) }, { scale: sway.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }] }]} />
            {mood === 'clap' ? <>{leftArm}{rightArm}</> : null}
            <Animated.Image source={art.head} style={[styles.layer, pivotStyle('head', width), { transform: [{ rotate: rotation }, { translateY: Animated.add(Animated.add(lift(sway, 4), hopY), droop.interpolate({ inputRange: [0, 1], outputRange: [0, 3 * k] })) }, { rotate: Animated.add(Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [-6, 6] }), tilt.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] })), droop.interpolate({ inputRange: [0, 1], outputRange: [0, -10] })).interpolate({ inputRange: [-50, 50], outputRange: ['-50deg', '50deg'] }) }] }]} />
            <Animated.Image testID="vey-eyes" source={art.eyes} style={[styles.layer, pivotStyle('eyes', width), { transform: [{ translateX: gestures.eyeX }, { translateY: gestures.eyeY }, { rotate: rotation }, { translateY: Animated.add(Animated.add(lift(sway, 4), hopY), droop.interpolate({ inputRange: [0, 1], outputRange: [0, 3 * k] })) }, { rotate: Animated.add(Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [-6, 6] }), tilt.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] })), droop.interpolate({ inputRange: [0, 1], outputRange: [0, -10] })).interpolate({ inputRange: [-50, 50], outputRange: ['-50deg', '50deg'] }) }, { scaleY: blink }] }]} />
        </View>
    );
    if (!interactive) return picture;
    return (
        <View {...gestures.panHandlers} style={styles.target}>
            <Pressable {...gestures.pressHandlers} style={styles.box} accessibilityRole="button"
                hitSlop={{ left: horizontalSlop, right: horizontalSlop, top: verticalSlop, bottom: verticalSlop }}
                accessibilityLabel={translate('vey.touch.label')} accessibilityHint={translate('vey.touch.hint')}
                accessibilityActions={[{ name: 'wave', label: translate('vey.touch.wave') }]}
                onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === 'wave') gestures.activate('hold');
                    if (event.nativeEvent.actionName === 'activate') gestures.activate('tap');
                }}>
                {picture}
            </Pressable>
        </View>
    );
}

function layerStyles(width: number) {
    return StyleSheet.create({
        target: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
        box: { width, height: heightFor(width) },
        layer: { position: 'absolute', left: 0, top: 0, width, height: heightFor(width) },
    });
}

type VeyReaction = 'tap' | 'hold' | 'giggle';

function useVeyGestures({ interactive, still, mood, scale, react, onReact }: {
    interactive: boolean; still: boolean; mood: VeyMood; scale: number;
    react: RefObject<(kind: VeyReaction) => void>; onReact?: (kind: 'tap' | 'hold') => void;
}) {
    const eyeX = useRef(new Animated.Value(0)).current;
    const eyeY = useRef(new Animated.Value(0)).current;
    const dragged = useRef(false);
    const taps = useRef<number[]>([]);
    const spring = useRef<Animated.CompositeAnimation | null>(null);
    useEffect(() => {
        taps.current = [];
        spring.current?.stop(); eyeX.setValue(0); eyeY.setValue(0);
        return () => { spring.current?.stop(); eyeX.setValue(0); eyeY.setValue(0); };
    }, [still, mood, interactive, eyeX, eyeY]);
    const pan = useMemo(() => {
        const release = () => {
            spring.current?.stop();
            if (still) { eyeX.setValue(0); eyeY.setValue(0); return; }
            spring.current = Animated.parallel([eyeX, eyeY].map(value => Animated.spring(value, {
                toValue: 0, useNativeDriver: true,
            })));
            spring.current.start();
        };
        return PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            onMoveShouldSetPanResponder: (_, { dx, dy }) => interactive && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy),
            onPanResponderGrant: () => { dragged.current = true; spring.current?.stop(); },
            onPanResponderMove: (_, { dx, dy }) => {
                if (still) return;
                const radius = 6 * scale;
                const factor = Math.min(1, radius / Math.max(1, Math.hypot(dx, dy)));
                eyeX.setValue(dx * factor); eyeY.setValue(dy * factor);
            },
            onPanResponderTerminationRequest: () => true,
            onPanResponderRelease: release,
            onPanResponderTerminate: release,
        });
    }, [interactive, still, scale, eyeX, eyeY]);
    const activate = (kind: 'tap' | 'hold') => {
        if (!interactive) return;
        void playSelection();
        onReact?.(kind);
        let reaction: VeyReaction = kind;
        if (kind === 'tap') {
            const now = Date.now();
            taps.current = [...taps.current.filter(time => now - time <= 3000), now];
            if (taps.current.length === 5) { reaction = 'giggle'; taps.current = []; }
        }
        react.current(reaction);
    };
    return {
        eyeX, eyeY, activate,
        panHandlers: interactive ? pan.panHandlers : {},
        pressHandlers: {
            delayLongPress: 400,
            onPressIn: () => { dragged.current = false; },
            // Pressability cancels a transferred responder and suppresses the tap after a hold.
            // Do not retain those guards here: accessibility clicks have no preceding press-in.
            onPress: () => activate('tap'),
            onLongPress: () => { if (!dragged.current) activate('hold'); },
        },
    };
}
