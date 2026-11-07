import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { ds } from '../theme';
import { EASE_OUT } from '../lib/motionCurves';
import { themedStyles, useThemedStyles } from './ui';

export const GLOW_SIZE = 320;

// The soft aqua light behind the large Vey. One static circle whose colour and shadow come from the accent token (so it
// follows light, dark, OLED and the chosen accent); only its opacity and scale animate. Reduce Motion fades it in without
// the scale.
export function BrandGlow({ shown, reduced }: { shown: boolean; reduced: boolean }) {
    const s = useThemedStyles(sheets);
    const level = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!shown) return;
        Animated.timing(level, { toValue: 1, duration: reduced ? ds.motion.state : ds.motion.sheet, easing: EASE_OUT, useNativeDriver: true }).start();
    }, [shown, reduced, level]);
    const grow = level.interpolate({ inputRange: [0, 1], outputRange: reduced ? [1, 1] : [0.92, 1] });
    return (
        <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[s.glow, { opacity: level, transform: [{ scale: grow }] }]}
        />
    );
}

const sheets = themedStyles((p) => ({
    glow: {
        position: 'absolute',
        width: GLOW_SIZE,
        height: GLOW_SIZE,
        borderRadius: GLOW_SIZE / 2,
        backgroundColor: p.accentSubtle,
        boxShadow: `0 0 96px 48px ${p.accentSubtle}`,
    },
}));
