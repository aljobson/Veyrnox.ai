import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../theme';
import {
    DOT_SCALE,
    FALLBACK_CAP_TOP,
    FALLBACK_STEM_TOP,
    I_INDEX,
    JUMP_MS,
    PRESS_MS,
    SINK_RATIO,
    WORD,
    mascotPath,
    type Box,
    type WordLayout,
} from '../lib/mascotPath';

const ACCENT_FROM = 7; // ".ai" is aqua, "VEYRNOX" is white (the website lockup)

// The website lockup (aqua V mark + "VEYRNOX.ai") where the mascot leaps in, hops along the capitals one letter at a time
// (each letter sinks under its weight), and lands on a dotless i as its dot. The row reads as "Veyrnox.ai" to a screen
// reader; the mascot is decoration. Reduce Motion skips straight to the end.
export function MascotWordmark({ fontSize = 36 }: { fontSize?: number }) {
    const [boxes, setBoxes] = useState<(Box | null)[]>(() => WORD.map(() => null));
    const [capTop, setCapTop] = useState(fontSize * FALLBACK_CAP_TOP);
    const [stemTop, setStemTop] = useState(fontSize * FALLBACK_STEM_TOP);
    const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
    const mascotHeight = fontSize * 0.95;

    useEffect(() => {
        let live = true;
        AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduceMotion(v), () => live && setReduceMotion(false));
        return () => {
            live = false;
        };
    }, []);

    const path = useMemo(() => {
        if (boxes.some((b) => !b)) return null;
        const layout: WordLayout = { letters: boxes as Box[], capTop, stemTop };
        return mascotPath(layout, mascotHeight, fontSize);
    }, [boxes, capTop, stemTop, mascotHeight, fontSize]);

    const x = useRef(new Animated.Value(0)).current;
    const y = useRef(new Animated.Value(0)).current;
    const tilt = useRef(new Animated.Value(0)).current; // 0 upright, 1 leaning into the hop
    const squash = useRef(new Animated.Value(0)).current; // 0 neutral to 1 squashed
    const shrink = useRef(new Animated.Value(0)).current; // 0 running size to 1 dot size
    const shown = useRef(new Animated.Value(0)).current;
    const press = useRef(WORD.map(() => new Animated.Value(0))).current; // per letter, 0 at rest to 1 under the weight
    const started = useRef(false);

    useEffect(() => {
        if (!path || reduceMotion === null || started.current) return;
        started.current = true;
        if (reduceMotion) {
            x.setValue(path.jump.x);
            y.setValue(path.jump.dotY);
            shrink.setValue(1);
            shown.setValue(1);
            return;
        }
        const native = { useNativeDriver: true };
        x.setValue(path.start.x);
        y.setValue(path.start.y);
        shown.setValue(1);

        const steps: Animated.CompositeAnimation[] = [];
        path.stops.forEach((stop, n) => {
            const half = stop.durationMs / 2;
            const prev = n > 0 ? path.stops[n - 1] : null;
            const air = [
                Animated.timing(x, { toValue: stop.x, duration: stop.durationMs, easing: Easing.inOut(Easing.sin), ...native }),
                Animated.sequence([
                    Animated.timing(y, { toValue: stop.apexY, duration: half, easing: Easing.out(Easing.quad), ...native }),
                    Animated.timing(y, { toValue: stop.y, duration: half, easing: Easing.in(Easing.quad), ...native }),
                ]),
                Animated.sequence([
                    Animated.timing(tilt, { toValue: 1, duration: half, ...native }),
                    Animated.timing(tilt, { toValue: 0, duration: half, ...native }),
                ]),
            ];
            // The letter it just left springs back up as it takes off.
            if (prev) air.push(Animated.spring(press[prev.letter], { toValue: 0, friction: 3, tension: 160, ...native }));
            steps.push(Animated.parallel(air));
            // Landing: the letter takes the weight and the mascot sinks with it.
            steps.push(
                Animated.parallel([
                    Animated.timing(press[stop.letter], { toValue: 1, duration: PRESS_MS, easing: Easing.out(Easing.quad), ...native }),
                    Animated.timing(y, { toValue: stop.y + path.sink, duration: PRESS_MS, easing: Easing.out(Easing.quad), ...native }),
                    Animated.sequence([
                        Animated.timing(squash, { toValue: 1, duration: PRESS_MS / 2, ...native }),
                        Animated.timing(squash, { toValue: 0, duration: PRESS_MS / 2, ...native }),
                    ]),
                ]),
            );
        });
        const last = path.stops[path.stops.length - 1];
        // The big jump from the a onto the i, then it squashes and shrinks into the dot.
        steps.push(
            Animated.parallel([
                Animated.timing(x, { toValue: path.jump.x, duration: JUMP_MS, easing: Easing.linear, ...native }),
                Animated.sequence([
                    Animated.timing(y, { toValue: path.jump.apexY, duration: JUMP_MS * 0.5, easing: Easing.out(Easing.cubic), ...native }),
                    Animated.timing(y, { toValue: path.jump.dotY, duration: JUMP_MS * 0.5, easing: Easing.in(Easing.cubic), ...native }),
                ]),
                Animated.timing(tilt, { toValue: 0, duration: JUMP_MS, ...native }),
                Animated.spring(press[last.letter], { toValue: 0, friction: 3, tension: 160, ...native }),
            ]),
            Animated.sequence([
                Animated.timing(squash, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), ...native }),
                Animated.parallel([
                    Animated.spring(squash, { toValue: 0, friction: 4, tension: 200, ...native }),
                    Animated.spring(shrink, { toValue: 1, friction: 6, tension: 90, ...native }),
                ]),
            ]),
        );
        const run = Animated.sequence(steps);
        run.start();
        return () => {
            started.current = false;
            run.stop();
        };
    }, [path, reduceMotion, x, y, tilt, squash, shrink, shown, press]);

    const scale = shrink.interpolate({ inputRange: [0, 1], outputRange: [1, DOT_SCALE] });
    const sx = Animated.multiply(scale, squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }));
    const sy = Animated.multiply(scale, squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.78] }));
    const rotate = tilt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '7deg'] });

    const word = [styles.word, { fontSize, lineHeight: fontSize * 1.2 }];
    const sink = fontSize * SINK_RATIO;
    // The mascot's bottom-centre is its anchor: scaling and squashing keep its feet on the letters.
    const mascotStyle = path
        ? {
              width: path.mascotWidth,
              height: path.mascotHeight,
              marginLeft: -path.mascotWidth / 2,
              marginTop: -path.mascotHeight,
              opacity: shown,
              transformOrigin: 'bottom' as const,
              transform: [{ translateX: x }, { translateY: y }, { rotate }, { scaleX: sx }, { scaleY: sy }],
          }
        : null;

    return (
        <View accessible accessibilityRole="header" accessibilityLabel="Veyrnox.ai" style={[styles.row, { marginTop: mascotHeight * 1.8 }]}>
            <Image source={require('../../assets/logo-mark.png')} style={{ width: fontSize * 1.37, height: fontSize * 1.37 * 0.94 }} contentFit="contain" />
            <View style={styles.letters}>
                {WORD.map((ch, i) => (
                    <Animated.View
                        key={i}
                        onLayout={(e) => {
                            const { x: lx, width } = e.nativeEvent.layout;
                            setBoxes((prev) => (prev[i]?.x === lx && prev[i]?.width === width ? prev : prev.map((b, j) => (j === i ? { x: lx, width } : b))));
                        }}
                        style={{
                            transformOrigin: 'bottom',
                            transform: [
                                { translateY: press[i].interpolate({ inputRange: [0, 1], outputRange: [0, sink] }) },
                                { scaleY: press[i].interpolate({ inputRange: [0, 1], outputRange: [1, 0.93] }) },
                            ],
                        }}
                    >
                        <Text
                            style={[word, i >= ACCENT_FROM && styles.ai]}
                            maxFontSizeMultiplier={1}
                            onTextLayout={(e) => {
                                const line = e.nativeEvent.lines[0];
                                if (!line) return;
                                if (i === 0) setCapTop(line.y + line.ascender - line.capHeight);
                                if (i === I_INDEX) setStemTop(line.y + line.ascender - line.xHeight);
                            }}
                        >
                            {ch}
                        </Text>
                    </Animated.View>
                ))}
                {mascotStyle ? (
                    <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[styles.mascot, mascotStyle]}>
                        <Image source={require('../../assets/mascot.png')} style={StyleSheet.absoluteFill} contentFit="contain" />
                    </Animated.View>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    letters: { flexDirection: 'row', alignItems: 'flex-start' },
    word: { color: colors.text, fontWeight: '800', letterSpacing: -0.8 },
    ai: { color: colors.accent },
    mascot: { position: 'absolute', left: 0, top: 0 },
});
