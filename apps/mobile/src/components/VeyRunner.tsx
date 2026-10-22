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

// A compact run cycle built around recognizable gait phases: contact, push-off, flight and recovery. The opposite arm
// counters each leading foot, the body rises during flight, and the shadow tightens beneath it. The restrained ranges
// keep Vey readable as a brand character at wordmark size instead of turning the entrance into a cartoon sprint.
export function VeyRunner({ stride, scale }: { stride: Animated.Value; scale: number }) {
    const w = SOURCE.width * scale;
    const h = SOURCE.height * scale;
    const k = (n: number) => n * scale;
    const phases = [0, 0.12, 0.36, 0.5, 0.62, 0.86, 1];
    // The feet include their short legs. Rotate them from the visible hip joints instead of sliding the whole artwork.
    const leftHip = { transformOrigin: `${k(192)}px ${k(378)}px` } as const;
    const rightHip = { transformOrigin: `${k(288)}px ${k(378)}px` } as const;
    const leftLeg = stride.interpolate({ inputRange: phases, outputRange: ['-24deg', '-10deg', '26deg', '30deg', '14deg', '-16deg', '-24deg'] });
    const rightLeg = stride.interpolate({ inputRange: phases, outputRange: ['30deg', '14deg', '-16deg', '-24deg', '-10deg', '26deg', '30deg'] });
    const leftFootY = stride.interpolate({ inputRange: phases, outputRange: [0, 0, k(2), -k(RUN.lift * 0.2), -k(RUN.lift * 0.6), -k(RUN.lift * 0.3), 0] });
    const rightFootY = stride.interpolate({ inputRange: phases, outputRange: [-k(RUN.lift * 0.2), -k(RUN.lift * 0.6), -k(RUN.lift * 0.3), 0, 0, k(2), -k(RUN.lift * 0.2)] });
    const leftArm = stride.interpolate({ inputRange: [0, 0.5, 1], outputRange: [`-${RUN.armSwing}deg`, `${RUN.armSwing}deg`, `-${RUN.armSwing}deg`] });
    const rightArm = stride.interpolate({ inputRange: [0, 0.5, 1], outputRange: [`${RUN.armSwing}deg`, `-${RUN.armSwing}deg`, `${RUN.armSwing}deg`] });
    const bob = stride.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -k(RUN.bob), 0, -k(RUN.bob), 0] });
    const bodyRoll = stride.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: ['-1deg', '1deg', '-1deg', '1deg', '-1deg'] });
    const shadowScale = stride.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0.84, 1, 0.84, 1] });
    const shadowOpacity = stride.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.48, 0.28, 0.48, 0.28, 0.48] });

    return (
        <View style={{ width: w, height: h }}>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: shadowOpacity, transform: [{ scaleX: shadowScale }] }]}>
                <Image source={art.shadow} style={StyleSheet.absoluteFill} contentFit="contain" />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, leftHip, { transform: [{ translateY: leftFootY }, { rotate: leftLeg }] }]}>
                <Image source={art.leftFoot} style={StyleSheet.absoluteFill} contentFit="contain" />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, rightHip, { transform: [{ translateY: rightFootY }, { rotate: rightLeg }] }]}>
                <Image source={art.rightFoot} style={StyleSheet.absoluteFill} contentFit="contain" />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: bob }, { rotate: bodyRoll }] }]}>
                <Animated.View style={[StyleSheet.absoluteFill, pivotStyle('leftArm', w), { transform: [{ rotate: leftArm }] }]}>
                    <Image source={art.leftArm} style={StyleSheet.absoluteFill} contentFit="contain" />
                </Animated.View>
                <Animated.View style={[StyleSheet.absoluteFill, pivotStyle('rightArm', w), { transform: [{ rotate: rightArm }] }]}>
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
