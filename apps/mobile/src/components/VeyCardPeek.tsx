import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { CANVAS, PEEK_CROP, heightFor } from '../lib/veyCharacter';

const head = require('../../assets/vey/head.png');
const eyes = require('../../assets/vey/eyes.png');

const RISE_MS = 380;

// Vey peeking over the top edge of the plan or pack the reader chose: head and paws show, the chin stays behind the
// card. Render it as the first child of the chosen card; it sits just above the card's top edge and rises from behind
// it. Decoration: no words, no touches, hidden from screen readers, and still under Reduce Motion.
export function VeyCardPeek({ width = 84 }: { width?: number }) {
    const k = width / CANVAS.width;
    const crop = PEEK_CROP * k;
    const rise = useRef(new Animated.Value(1)).current;
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
            rise.setValue(0);
            return;
        }
        rise.setValue(1);
        const animation = Animated.timing(rise, { toValue: 0, duration: RISE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
        animation.start();
        return () => animation.stop();
    }, [still, rise]);

    const layer = { position: 'absolute', left: 0, top: 0, width, height: heightFor(width) } as const;
    const paw = { position: 'absolute', top: 70 * k, width: 26 * k, height: 18 * k, borderRadius: 13 * k, backgroundColor: '#dbe8ea', borderColor: '#789b9f', borderWidth: 1.5 } as const;

    return (
        <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.crop, { width, height: crop, top: -crop, marginLeft: -width / 2 }]}
        >
            <Animated.View style={{ width, height: crop, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, crop] }) }] }}>
                <Image source={head} style={layer} />
                <Image source={eyes} style={layer} />
                <View style={[paw, { left: 36 * k }]} />
                <View style={[paw, { left: 98 * k }]} />
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    crop: { position: 'absolute', left: '50%', overflow: 'hidden' },
});
