import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ds } from '../theme';
import { t } from '../lib/i18n';
import { BrandIntro } from './BrandIntro';
import { VeyCharacter } from './VeyCharacter';
import { Button, themedStyles, useThemedStyles } from './ui';
import { useReducedMotion } from './ui/useReducedMotion';

// The first page of a new install: the Veyrnox.ai name with the little Vey running across it and landing as the dot of the
// i, then a large Vey arriving in the middle of the page below the name, and a button on to the language choice.
export function BrandSplash({ onContinue }: { onContinue(): void }) {
    const s = useThemedStyles(sheets);
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const [landed, setLanded] = useState(false);
    const arrive = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!landed) return;
        if (reduceMotion) { arrive.setValue(1); return; }
        Animated.timing(arrive, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [landed, reduceMotion, arrive]);
    const big = {
        opacity: arrive,
        transform: [
            { translateY: arrive.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            { scale: arrive.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
        ],
    };
    return (
        <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={s.middle}>
                <BrandIntro fontSize={40} onDone={() => setLanded(true)} />
                <Animated.View style={[s.big, big]}>{landed ? <VeyCharacter width={220} mood="wave" /> : null}</Animated.View>
            </View>
            <View style={s.footer}>
                <Button label={t('vibe.language.continue')} onPress={onContinue} />
            </View>
        </View>
    );
}
const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: ds.space.xxl, padding: ds.space.gutter },
    big: { minHeight: 240, alignItems: 'center', justifyContent: 'center' },
    footer: { padding: ds.space.gutter },
}));
