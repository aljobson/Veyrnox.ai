import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { CANVAS, heightFor, pivotStyle } from '../lib/veyCharacter';

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

// Vey with a head that nods, arms that sway (the right one waves), eyes that blink and a core that glows. All of it runs
// on the native thread. With Reduce Motion on, Vey stands still. The picture is decoration: whatever holds it carries the label.
export function VeyCharacter({ width = 72 }: { width?: number }) {
    const k = width / CANVAS.width;
    const sway = useRef(new Animated.Value(0.5)).current;
    const wave = useRef(new Animated.Value(0.5)).current;
    const blink = useRef(new Animated.Value(1)).current;
    const [still, setStill] = useState(false);

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
        if (still) {
            sway.setValue(0.5);
            wave.setValue(0.5);
            blink.setValue(1);
            return;
        }
        const loops = [
            swing(sway, 1500),
            swing(wave, 900),
            Animated.loop(
                Animated.sequence([
                    Animated.delay(2400),
                    Animated.timing(blink, { toValue: 0.12, duration: 70, useNativeDriver: true }),
                    Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true }),
                    Animated.delay(2000),
                ]),
            ),
        ];
        loops.forEach((l) => l.start());
        return () => loops.forEach((l) => l.stop());
    }, [still, sway, wave, blink]);

    const turn = (value: Animated.Value, from: number, to: number) => value.interpolate({ inputRange: [0, 1], outputRange: [`${from}deg`, `${to}deg`] });
    const lift = (value: Animated.Value, by: number) => value.interpolate({ inputRange: [0, 1], outputRange: [0, -by * k] });

    const styles = useMemo(() => layerStyles(width), [width]);

    return (
        <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
            <Animated.Image source={art.base} style={styles.layer} />
            <Animated.Image source={art.leftArm} style={[styles.layer, pivotStyle('leftArm', width), { transform: [{ rotate: turn(sway, 12, -14) }] }]} />
            <Animated.Image source={art.rightArm} style={[styles.layer, pivotStyle('rightArm', width), { transform: [{ rotate: turn(wave, 16, -26) }] }]} />
            <Animated.Image source={art.body} style={[styles.layer, { transform: [{ translateY: lift(sway, 2) }] }]} />
            <Animated.Image source={art.core} style={[styles.layer, pivotStyle('core', width), { opacity: sway.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }), transform: [{ translateY: lift(sway, 2) }, { scale: sway.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }] }]} />
            <Animated.Image source={art.head} style={[styles.layer, pivotStyle('head', width), { transform: [{ translateY: lift(sway, 3) }, { rotate: turn(sway, -5, 5) }] }]} />
            <Animated.Image source={art.eyes} style={[styles.layer, pivotStyle('eyes', width), { transform: [{ translateY: lift(sway, 3) }, { rotate: turn(sway, -5, 5) }, { scaleY: blink }] }]} />
        </View>
    );
}

function layerStyles(width: number) {
    return StyleSheet.create({
        box: { width, height: heightFor(width) },
        layer: { position: 'absolute', left: 0, top: 0, width, height: heightFor(width) },
    });
}
