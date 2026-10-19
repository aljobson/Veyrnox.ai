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
    const hop = useRef(new Animated.Value(0)).current;
    const cheer = useRef(new Animated.Value(0)).current;
    const tilt = useRef(new Animated.Value(0.5)).current;
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
            hop.setValue(0);
            cheer.setValue(0);
            tilt.setValue(0.5);
            blink.setValue(1);
            return;
        }
        const t = (v: Animated.Value, toValue: number, duration: number) => Animated.timing(v, { toValue, duration, easing: ease, useNativeDriver: true });
        // Every few seconds Vey does something new: a hop, a two-arm cheer, or a look to one side.
        const moves = Animated.loop(
            Animated.sequence([
                Animated.delay(1800),
                Animated.parallel([
                    Animated.sequence([t(hop, 1, 220), t(hop, 0, 260), t(hop, 1, 200), t(hop, 0, 240)]),
                    Animated.sequence([t(cheer, 1, 260), Animated.delay(420), t(cheer, 0, 300)]),
                ]),
                Animated.delay(1600),
                Animated.sequence([t(tilt, 0, 380), Animated.delay(500), t(tilt, 1, 520), Animated.delay(400), t(tilt, 0.5, 380)]),
            ]),
        );
        const loops = [
            moves,
            swing(sway, 1100),
            swing(wave, 520),
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
    const hopY = hop.interpolate({ inputRange: [0, 1], outputRange: [0, -8 * k] });
    const lift = (value: Animated.Value, by: number) => value.interpolate({ inputRange: [0, 1], outputRange: [0, -by * k] });

    const styles = useMemo(() => layerStyles(width), [width]);

    return (
        <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
            <Animated.Image source={art.base} style={styles.layer} />
            <Animated.Image source={art.leftArm} style={[styles.layer, pivotStyle('leftArm', width), { transform: [{ rotate: Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [28, -28] }), cheer.interpolate({ inputRange: [0, 1], outputRange: [0, -70] })).interpolate({ inputRange: [-120, 120], outputRange: ['-120deg', '120deg'] }) }, { translateY: hopY }] }]} />
            <Animated.Image source={art.rightArm} style={[styles.layer, pivotStyle('rightArm', width), { transform: [{ rotate: Animated.add(wave.interpolate({ inputRange: [0, 1], outputRange: [38, -48] }), cheer.interpolate({ inputRange: [0, 1], outputRange: [0, 60] })).interpolate({ inputRange: [-120, 120], outputRange: ['-120deg', '120deg'] }) }, { translateY: hopY }] }]} />
            <Animated.Image source={art.body} style={[styles.layer, { transform: [{ translateY: Animated.add(lift(sway, 3), hopY) }] }]} />
            <Animated.Image source={art.core} style={[styles.layer, pivotStyle('core', width), { opacity: sway.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }), transform: [{ translateY: Animated.add(lift(sway, 3), hopY) }, { scale: sway.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }] }]} />
            <Animated.Image source={art.head} style={[styles.layer, pivotStyle('head', width), { transform: [{ translateY: Animated.add(lift(sway, 4), hopY) }, { rotate: Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [-6, 6] }), tilt.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] })).interpolate({ inputRange: [-40, 40], outputRange: ['-40deg', '40deg'] }) }] }]} />
            <Animated.Image source={art.eyes} style={[styles.layer, pivotStyle('eyes', width), { transform: [{ translateY: Animated.add(lift(sway, 4), hopY) }, { rotate: Animated.add(sway.interpolate({ inputRange: [0, 1], outputRange: [-6, 6] }), tilt.interpolate({ inputRange: [0, 1], outputRange: [-14, 14] })).interpolate({ inputRange: [-40, 40], outputRange: ['-40deg', '40deg'] }) }, { scaleY: blink }] }]} />
        </View>
    );
}

function layerStyles(width: number) {
    return StyleSheet.create({
        box: { width, height: heightFor(width) },
        layer: { position: 'absolute', left: 0, top: 0, width, height: heightFor(width) },
    });
}
