import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '../theme';
import { VeyRunner } from './VeyRunner';
import {
    DOT_SCALE,
    FIGURE,
    HOP_MS,
    FALLBACK_CAP_TOP,
    FALLBACK_STEM_TOP,
    I_INDEX,
    JUMP_MS,
    SINK_RATIO,
    STRIDE_MS,
    WORD,
    mascotPath,
    type Box,
    type WordLayout,
} from '../lib/mascotPath';

const ACCENT_FROM = 7; // ".ai" is aqua, "VEYRNOX" is white (the website lockup)

// The website lockup (aqua V mark + "VEYRNOX.ai") where the mascot leaps in, runs along the capitals one letter at a time
// (each letter sinks under its weight), and lands on a dotless i as its dot. The row reads as "Veyrnox.ai" to a screen
// reader; the mascot is decoration. Reduce Motion skips straight to the end.
export function MascotWordmark({ fontSize = 36 }: { fontSize?: number }) {
    const [boxes, setBoxes] = useState<(Box | null)[]>(() => WORD.map(() => null));
    const [capTop, setCapTop] = useState(fontSize * FALLBACK_CAP_TOP);
    const [stemTop, setStemTop] = useState(fontSize * FALLBACK_STEM_TOP);
    const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
    const mascotHeight = fontSize * 0.95;
    const figureScale = mascotHeight / (FIGURE.bottom - FIGURE.top); // screen points per source pixel

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

    const tilt = useRef(new Animated.Value(0)).current; // 0 upright, 1 leaning into the run
    const squash = useRef(new Animated.Value(0)).current; // 0 neutral to 1 squashed
    const shrink = useRef(new Animated.Value(0)).current; // 0 running size to 1 dot size
    const shown = useRef(new Animated.Value(0)).current;
    const stride = useRef(new Animated.Value(0)).current; // one left-right step, 0 to 1 on a loop while it runs
    const along = useRef(new Animated.Value(0)).current; // 0 at the start of the run, 1 on the a: everything on the run follows this
    const jumpX = useRef(new Animated.Value(0)).current; // the last jump, from the a onto the i, relative to the a
    const jumpY = useRef(new Animated.Value(0)).current;
    const release = useRef(new Animated.Value(1)).current; // 1 while the a carries the weight, 0 once it has jumped off
    const started = useRef(false);

    // One continuous run: where it is, how high its feet are and how hard each letter is pressed are all read off `along`
    // on the native thread, so there is no pause at a letter and nothing waits on the JS thread.
    const track = useMemo(() => {
        if (!path) return null;
        const total = path.stops.reduce((t, stop) => t + stop.durationMs, 0);
        const marks = [0];
        let at = 0;
        path.stops.forEach((stop) => {
            at += stop.durationMs;
            marks.push(at / total);
        });
        const clamp = { extrapolate: 'clamp' as const };
        const xs = [path.start.x, ...path.stops.map((stop) => stop.x)];
        const ys = [path.start.y, ...path.stops.map((stop) => stop.y)];
        const near = (HOP_MS / total) * 0.6;
        const press = new Map<number, Animated.AnimatedInterpolation<number>>();
        path.stops.forEach((stop, n) => {
            const f = marks[n + 1];
            const dip = along.interpolate({ inputRange: [f - near, f, f + near], outputRange: [0, 1, 0], ...clamp });
            press.set(stop.letter, n === path.stops.length - 1 ? Animated.multiply(dip, release).interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) : dip);
        });
        return {
            total,
            x: along.interpolate({ inputRange: marks, outputRange: xs, ...clamp }),
            y: along.interpolate({ inputRange: marks, outputRange: ys, ...clamp }),
            press,
        };
    }, [path, along, release]);

    useEffect(() => {
        if (!path || !track || reduceMotion === null || started.current) return;
        started.current = true;
        const last = path.stops[path.stops.length - 1];
        if (reduceMotion) {
            along.setValue(1);
            jumpX.setValue(path.jump.x - last.x);
            jumpY.setValue(path.jump.dotY - last.y);
            release.setValue(0);
            shrink.setValue(1);
            shown.setValue(1);
            return;
        }
        const native = { useNativeDriver: true };
        shown.setValue(0);
        const run = Animated.sequence([
            // A grounded run across the word: constant travel, a restrained forward posture and a short fade-in.
            Animated.parallel([
                Animated.timing(along, { toValue: 1, duration: track.total, easing: Easing.linear, ...native }),
                Animated.timing(tilt, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), ...native }),
                Animated.timing(shown, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), ...native }),
            ]),
            // A clean final take-off and landing, followed by a controlled lock-up into the i dot.
            Animated.parallel([
                Animated.timing(jumpX, { toValue: path.jump.x - last.x, duration: JUMP_MS, easing: Easing.inOut(Easing.cubic), ...native }),
                Animated.sequence([
                    Animated.timing(jumpY, { toValue: path.jump.apexY - last.y, duration: JUMP_MS * 0.5, easing: Easing.out(Easing.cubic), ...native }),
                    Animated.timing(jumpY, { toValue: path.jump.dotY - last.y, duration: JUMP_MS * 0.5, easing: Easing.in(Easing.cubic), ...native }),
                ]),
                Animated.timing(tilt, { toValue: 0, duration: JUMP_MS, ...native }),
                Animated.timing(release, { toValue: 0, duration: 180, ...native }),
            ]),
            Animated.sequence([
                Animated.timing(squash, { toValue: 1, duration: 70, easing: Easing.out(Easing.quad), ...native }),
                Animated.parallel([
                    Animated.timing(squash, { toValue: 0, duration: 190, easing: Easing.out(Easing.cubic), ...native }),
                    Animated.timing(shrink, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), ...native }),
                ]),
            ]),
        ]);
        const legs = Animated.loop(Animated.timing(stride, { toValue: 1, duration: STRIDE_MS, easing: Easing.linear, ...native }));
        legs.start();
        // The arms and legs stop once it has landed as the dot.
        run.start(() => {
            legs.stop();
            stride.setValue(0);
        });
        return () => {
            started.current = false;
            run.stop();
            legs.stop();
        };
    }, [path, track, reduceMotion, along, jumpX, jumpY, release, tilt, squash, shrink, shown, stride]);

    const scale = shrink.interpolate({ inputRange: [0, 1], outputRange: [1, DOT_SCALE] });
    const sx = Animated.multiply(scale, squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }));
    const sy = Animated.multiply(scale, squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }));
    const rotate = tilt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '5deg'] });

    const word = [styles.word, { fontSize, lineHeight: fontSize * 1.2 }];
    const sink = fontSize * SINK_RATIO;
    const zero = useRef(new Animated.Value(0).interpolate({ inputRange: [0, 1], outputRange: [0, 1] })).current; // a letter nobody stands on
    // The mascot's bottom-centre is its anchor: scaling and squashing keep its feet on the letters.
    const mascotStyle = path && track
        ? {
              width: path.mascotWidth,
              height: path.mascotHeight,
              marginLeft: -path.mascotWidth / 2,
              marginTop: -path.mascotHeight,
              opacity: shown,
              transformOrigin: 'bottom' as const,
              transform: [{ translateX: Animated.add(track.x, jumpX) }, { translateY: Animated.add(track.y, jumpY) }, { rotate }, { scaleX: sx }, { scaleY: sy }],
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
                                { translateY: (track?.press.get(i) ?? zero).interpolate({ inputRange: [0, 1], outputRange: [0, sink] }) },
                                { scaleY: (track?.press.get(i) ?? zero).interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) },
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
                        <View style={{ position: 'absolute', left: path!.mascotWidth / 2 - ((FIGURE.left + FIGURE.right) / 2) * figureScale, top: path!.mascotHeight - FIGURE.bottom * figureScale }}>
                            <VeyRunner stride={stride} scale={figureScale} />
                        </View>
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
