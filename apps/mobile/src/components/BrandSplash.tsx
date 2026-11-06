import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ds } from '../theme';
import { t } from '../lib/i18n';
import { DOT_SCALE } from '../lib/mascotPath';
import { leapTarget, type Leap } from '../lib/splashLeap';
import { BrandIntro } from './BrandIntro';
import type { WordmarkRest } from './MascotWordmark';
import { VeyCharacter } from './VeyCharacter';
import { Button, themedStyles, useThemedStyles } from './ui';
import { useReducedMotion } from './ui/useReducedMotion';

const NAME_SIZE = 40; // the wordmark's font size; the running mascot is 0.95 of it tall
const PAUSE_MS = 500; // a beat on the i before the mascot hops off

// The first page of a new install: the Veyrnox.ai name with the little Vey running across it and landing as the dot of the
// i. After a beat the dot hops off the i, arcs across the page and lands in the middle below the name, growing into the large
// waving Vey. Reduce Motion, or a position that cannot be measured, skips the hop and shows the large Vey at once.
export function BrandSplash({ onContinue }: { onContinue(): void }) {
    const s = useThemedStyles(sheets);
    const insets = useSafeAreaInsets();
    const reduceMotion = useReducedMotion();
    const reduced = useRef(reduceMotion);
    reduced.current = reduceMotion;
    const slot = useRef<ComponentRef<typeof View>>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [leap, setLeap] = useState<Leap | null>(null);
    const [landed, setLanded] = useState(false);
    const arrive = useRef(new Animated.Value(0)).current;
    useEffect(() => () => clearTimeout(timer.current), []);
    useEffect(() => {
        if (!landed) return;
        if (reduced.current) { arrive.setValue(1); return; }
        Animated.timing(arrive, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    }, [landed, arrive]);

    function onDone(rest: WordmarkRest | null) {
        if (reduced.current || !rest) { setLanded(true); return; }
        timer.current = setTimeout(() => {
            slot.current?.measureInWindow((x, y, width, height) => {
                if (!(width > 0 && height > 0)) { setLanded(true); return; }
                setLeap(leapTarget({ x: rest.feetX, y: rest.feetY }, { x, y, width, height }, NAME_SIZE * 0.95 * DOT_SCALE));
            });
        }, PAUSE_MS);
    }
    return (
        <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={s.middle}>
                <BrandIntro fontSize={NAME_SIZE} onDone={onDone} leap={leap} onLeapDone={() => setLanded(true)} fadeOut={landed} />
                <View ref={slot} collapsable={false} style={s.slot}>
                    <Animated.View style={{ opacity: arrive }}>{landed ? <VeyCharacter width={220} mood="wave" /> : null}</Animated.View>
                </View>
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
    slot: { minHeight: 240, alignItems: 'center', justifyContent: 'center' },
    footer: { padding: ds.space.gutter },
}));
