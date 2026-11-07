import { useEffect, useRef, type ReactNode } from 'react';
import { Animated } from 'react-native';
import { ds } from '../theme';
import { EASE_OUT } from '../lib/motionCurves';
import { useReducedMotion } from './ui/useReducedMotion';

const STAGGER_MS = 40; // short, so the list never feels slow
const MAX_STAGGERED = 8; // rows past this arrive with the last staggered one

// Eases one row in (opacity and an 8 pt rise) once `active` turns true, a little after the row before it. Until then it is
// invisible. Reduce Motion keeps the fade and drops the rise.
export function Reveal({ index, active, children }: { index: number; active: boolean; children: ReactNode }) {
    const reduced = useReducedMotion();
    const level = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!active) return;
        const run = Animated.timing(level, { toValue: 1, delay: Math.min(index, MAX_STAGGERED) * STAGGER_MS, duration: ds.motion.enter, easing: EASE_OUT, useNativeDriver: true });
        run.start();
        return () => run.stop();
    }, [active, index, level]);
    const rise = level.interpolate({ inputRange: [0, 1], outputRange: reduced ? [0, 0] : [8, 0] });
    return <Animated.View style={{ opacity: level, transform: [{ translateY: rise }] }}>{children}</Animated.View>;
}
