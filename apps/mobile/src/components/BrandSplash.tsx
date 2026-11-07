import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ds } from '../theme';
import { playLanding } from '../lib/haptics';
import { EASE_OUT } from '../lib/motionCurves';
import { DOT_SCALE } from '../lib/mascotPath';
import { leapTarget, measureWindow, type Leap } from '../lib/splashLeap';
import { BrandGlow } from './BrandGlow';
import { BrandIntro } from './BrandIntro';
import type { WordmarkRest } from './MascotWordmark';
import { VeyCharacter } from './VeyCharacter';
import { themedStyles, useThemedStyles } from './ui';
import { useReducedMotion } from './ui/useReducedMotion';

const NAME_SIZE = 40; // the wordmark's font size; the running mascot is 0.95 of it tall
const PAUSE_MS = 500; // a beat on the i before the mascot hops off
const HOLD_MS = 1500; // the large Vey waves for a moment before the page fades away
const GIVE_UP_MS = 9000; // if the animation never reports in, move on anyway
export const SLOT_WIDTH = 220; // the large Vey's slot has a real size from the start, so it can be measured before Vey is in it
export const SLOT_HEIGHT = 240;

// The first page of a new install: the Veyrnox.ai name with the little Vey running across it and landing as the dot of the
// i. After a beat the dot hops off the i, arcs across the page and lands in the middle below the name, growing into the large
// waving Vey in a soft aqua glow, with one soft haptic as it lands. It then holds a moment and fades away, revealing the
// language choice mounted underneath; a tap anywhere moves on sooner. Reduce Motion (even switched on mid-way) skips the hop
// and shows the large Vey still; a screen reader skips the page altogether.
export function BrandSplash({ onFadeStart, onFinish }: { onFadeStart?: () => void; onFinish(): void }) {
    const s = useThemedStyles(sheets);
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const reduced = useRef(reduceMotion);
    reduced.current = reduceMotion;
    const slot = useRef<ComponentRef<typeof View>>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hopping = useRef(false); // a hop is pending (pause, measuring) or under way
    const settled = useRef(false); // the hop was cancelled by Reduce Motion: no landing haptic
    const alive = useRef(true);
    const [leap, setLeap] = useState<Leap | null>(null);
    const [landed, setLanded] = useState(false);
    const arrive = useRef(new Animated.Value(0)).current;
    const fade = useRef(new Animated.Value(1)).current;
    const start = useRef(onFadeStart);
    start.current = onFadeStart;
    const finish = useRef(onFinish);
    finish.current = onFinish;
    const ended = useRef(false);

    function end(instant = false) {
        if (ended.current) return;
        ended.current = true;
        clearTimeout(timer.current);
        hopping.current = false;
        setLeap(null); // a hop still in flight is cancelled: no landing feedback or arrival once the page is leaving
        start.current?.();
        const duration = instant ? 0 : reduced.current ? ds.motion.state : ds.motion.sheet;
        Animated.timing(fade, { toValue: 0, duration, easing: EASE_OUT, useNativeDriver: true }).start(() => alive.current && finish.current());
    }
    // Drop the hop and show the large Vey where it belongs, still.
    function settle() {
        hopping.current = false;
        settled.current = true;
        clearTimeout(timer.current);
        setLeap(null);
        setLanded(true);
    }

    useEffect(() => {
        alive.current = true;
        const giveUp = setTimeout(() => end(), GIVE_UP_MS);
        // A person using a screen reader does not wait for a timed page: the language choice is the real content.
        AccessibilityInfo.isScreenReaderEnabled().then((on) => on && alive.current && end(true), () => {});
        // ...including one switched on while the page is playing (for example with the accessibility shortcut).
        const reader = AccessibilityInfo.addEventListener('screenReaderChanged', (on) => { if (on && alive.current) end(true); });
        return () => {
            reader.remove();
            alive.current = false;
            clearTimeout(timer.current);
            clearTimeout(giveUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Reduce Motion switched on while the hop is pending or in flight.
    useEffect(() => {
        if (reduceMotion && hopping.current) settle();
    }, [reduceMotion]);
    useEffect(() => {
        if (!landed) return;
        if (reduced.current) arrive.setValue(1);
        else Animated.timing(arrive, { toValue: 1, duration: ds.motion.state, easing: EASE_OUT, useNativeDriver: true }).start();
        const hold = setTimeout(() => end(), HOLD_MS);
        return () => clearTimeout(hold);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [landed, arrive]);

    function onDone(rest: WordmarkRest | null) {
        if (reduced.current || !rest) { setLanded(true); return; }
        hopping.current = true;
        timer.current = setTimeout(() => {
            if (!alive.current || ended.current) return;
            if (reduced.current) { settle(); return; }
            void measureWindow(slot.current).then((box) => {
                if (!alive.current || ended.current) return;
                if (reduced.current || !box || !(box.width > 0 && box.height > 0)) { settle(); return; }
                setLeap(leapTarget({ x: rest.feetX, y: rest.feetY }, box, NAME_SIZE * 0.95 * DOT_SCALE));
            });
        }, PAUSE_MS);
    }
    function onLand() {
        if (reduced.current || settled.current || ended.current || !alive.current) return;
        void playLanding();
    }
    function onLeapDone() {
        hopping.current = false;
        if (ended.current || !alive.current) return;
        setLanded(true);
    }

    return (
        <Animated.View style={[StyleSheet.absoluteFill, s.screen, { opacity: fade, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={() => end()} />
            <View pointerEvents="none" style={s.middle}>
                <BrandIntro fontSize={NAME_SIZE} onDone={onDone} leap={leap} onLand={onLand} onLeapDone={onLeapDone} fadeOut={landed} />
                <View ref={slot} collapsable={false} style={s.slot}>
                    <BrandGlow shown={landed} reduced={reduceMotion} />
                    <Animated.View style={{ opacity: arrive }}>{landed ? <VeyCharacter width={SLOT_WIDTH} mood="wave" /> : null}</Animated.View>
                </View>
            </View>
        </Animated.View>
    );
}
const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: ds.space.xxl, padding: ds.space.gutter },
    slot: { width: SLOT_WIDTH, height: SLOT_HEIGHT, alignItems: 'center', justifyContent: 'center' },
}));
