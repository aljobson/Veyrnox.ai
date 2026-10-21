import { Animated, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { pivotStyle } from '../lib/veyCharacter';
import { RUN, SOURCE } from '../lib/mascotPath';

const art = {
    shadow: require('../../assets/vey/shadow.png'),
    leftFoot: require('../../assets/vey/left-foot.png'),
    rightFoot: require('../../assets/vey/right-foot.png'),
    leftArm: require('../../assets/vey/left-arm.png'),
    rightArm: require('../../assets/vey/right-arm.png'),
    body: require('../../assets/vey/body.png'),
    core: require('../../assets/vey/core.png'),
    head: require('../../assets/vey/head.png'),
    eyes: require('../../assets/vey/eyes.png'),
};

// Vey mid-run, drawn from the same layered pictures as VeyCharacter. `stride` is one full left-right step, 0 to 1 on a
// loop: the arms swing against each other, the feet scissor and lift in turn, and the body bobs twice. `scale` is screen
// points per source pixel; the layers sit on the 480 x 510 source canvas, so the figure keeps its place in the wordmark.
// Decoration only: whatever holds it carries the label.
export function VeyRunner({ stride, scale }: { stride: Animated.Value; scale: number }) {
    const w = SOURCE.width * scale;
    const h = SOURCE.height * scale;
    const k = (n: number) => n * scale;
    const swing = (a: number, b: number) => stride.interpolate({ inputRange: [0, 0.5, 1], outputRange: [`${a}deg`, `${b}deg`, `${a}deg`] });
    const leftFootY = stride.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -k(RUN.lift), 0, 0, 0] });
    const rightFootY = stride.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 0, 0, -k(RUN.lift), 0] });
    const leftFootX = stride.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-k(RUN.reach), k(RUN.reach), -k(RUN.reach)] });
    const rightFootX = stride.interpolate({ inputRange: [0, 0.5, 1], outputRange: [k(RUN.reach), -k(RUN.reach), k(RUN.reach)] });
    const bob = stride.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -k(RUN.bob), 0, -k(RUN.bob), 0] });

    return (
        <View style={{ width: w, height: h }}>
            <Image source={art.shadow} style={StyleSheet.absoluteFill} contentFit="contain" />
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: leftFootX }, { translateY: leftFootY }] }]}>
                <Image source={art.leftFoot} style={StyleSheet.absoluteFill} contentFit="contain" />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: rightFootX }, { translateY: rightFootY }] }]}>
                <Image source={art.rightFoot} style={StyleSheet.absoluteFill} contentFit="contain" />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: bob }] }]}>
                <Animated.View style={[StyleSheet.absoluteFill, pivotStyle('leftArm', w), { transform: [{ rotate: swing(-RUN.armSwing, RUN.armSwing) }] }]}>
                    <Image source={art.leftArm} style={StyleSheet.absoluteFill} contentFit="contain" />
                </Animated.View>
                <Animated.View style={[StyleSheet.absoluteFill, pivotStyle('rightArm', w), { transform: [{ rotate: swing(RUN.armSwing, -RUN.armSwing) }] }]}>
                    <Image source={art.rightArm} style={StyleSheet.absoluteFill} contentFit="contain" />
                </Animated.View>
                <Image source={art.body} style={StyleSheet.absoluteFill} contentFit="contain" />
                <Image source={art.core} style={StyleSheet.absoluteFill} contentFit="contain" />
                <Image source={art.head} style={StyleSheet.absoluteFill} contentFit="contain" />
                <Image source={art.eyes} style={StyleSheet.absoluteFill} contentFit="contain" />
            </Animated.View>
        </View>
    );
}
