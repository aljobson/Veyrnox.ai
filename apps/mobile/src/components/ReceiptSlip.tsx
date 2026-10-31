import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, type LayoutChangeEvent } from 'react-native';
import { ds } from '../theme';
import { Text } from './ui/Text';
import { themedStyles, useThemedStyles } from './ui/AppearanceContext';
import { useReducedMotion } from './ui/useReducedMotion';

export const PRINT_MS = 1400;
const TOOTH = 12;
const TEETH = 40;

export interface ReceiptRow {
    label: string;
    value: string;
}

export interface ReceiptSlipProps {
    title: string;
    rows: readonly ReceiptRow[];
    footer: string;
}

// A paper slip that feeds out of a slot after a purchase clears. Purely decorative motion: the rows are
// in place from the first frame for screen readers, and reduced motion shows the slip already printed.
export function ReceiptSlip({ title, rows, footer }: ReceiptSlipProps) {
    const s = useThemedStyles(sheets);
    const reduced = useReducedMotion();
    const [height, setHeight] = useState(0);
    const feed = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (!height) return;
        if (reduced) { feed.setValue(1); return; }
        Animated.timing(feed, { toValue: 1, duration: PRINT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        return () => feed.stopAnimation();
    }, [feed, height, reduced]);
    const translateY = feed.interpolate({ inputRange: [0, 1], outputRange: [-height, 0] });
    const onLayout = (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height);
    return (
        <View style={s.wrap} accessible accessibilityLabel={[title, ...rows.map(row => `${row.label} ${row.value}`), footer].join('. ')}>
            <View style={s.slot} />
            <View style={s.clip}>
                <Animated.View onLayout={onLayout} style={[s.paper, { opacity: height ? 1 : 0, transform: [{ translateY }] }]}>
                    <Text variant="footnote" style={s.title}>{title}</Text>
                    <View style={s.rule} />
                    {rows.map(row => (
                        <View key={row.label} style={s.row}>
                            <Text variant="footnote" style={s.ink}>{row.label}</Text>
                            <Text variant="footnote" style={[s.ink, s.value]}>{row.value}</Text>
                        </View>
                    ))}
                    <View style={s.rule} />
                    <Text variant="footnote" style={s.footer}>{footer}</Text>
                    <View style={s.teeth}>
                        {Array.from({ length: TEETH }, (_, i) => <View key={i} style={s.tooth} />)}
                    </View>
                </Animated.View>
            </View>
        </View>
    );
}

const PAPER = '#f5f1e8';
const PAPER_INK = '#1d1b17';
const sheets = themedStyles((p) => ({
    wrap: { alignSelf: 'center', width: '86%', maxWidth: 340 },
    slot: { height: 8, borderRadius: 4, backgroundColor: p.textPrimary, opacity: 0.85 },
    clip: { overflow: 'hidden', marginHorizontal: ds.space.md, marginTop: -3 },
    paper: { backgroundColor: PAPER, paddingHorizontal: ds.space.lg, paddingTop: ds.space.lg, gap: ds.space.xs },
    title: { color: PAPER_INK, textAlign: 'center', letterSpacing: 2, fontWeight: '700' },
    rule: { borderBottomWidth: 1, borderStyle: 'dashed', borderColor: PAPER_INK, opacity: 0.35, marginVertical: ds.space.xs },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: ds.space.md },
    ink: { color: PAPER_INK },
    value: { fontVariant: ['tabular-nums'], fontWeight: '600' },
    footer: { color: PAPER_INK, opacity: 0.7, textAlign: 'center', paddingBottom: ds.space.sm },
    teeth: { flexDirection: 'row', height: TOOTH / 2, marginHorizontal: -ds.space.lg, overflow: 'hidden', backgroundColor: p.bg },
    tooth: { width: 0, height: 0, borderLeftWidth: TOOTH / 2, borderRightWidth: TOOTH / 2, borderTopWidth: TOOTH / 2,
        borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: PAPER },
}));
