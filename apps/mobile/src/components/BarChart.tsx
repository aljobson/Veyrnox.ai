import { StyleSheet, Text, View } from 'react-native';
import { barHeights } from '../lib/publishAnalytics';
import { colors } from '../theme';

// A small bar chart made of views, so it adds no dependency. It is described to a screen reader as text.
export function BarChart({ values, label, summary }: { values: readonly number[]; label: string; summary: string }) {
    const heights = barHeights(values);
    return (
        <View accessible accessibilityRole="image" accessibilityLabel={`${label}. ${summary}`} style={styles.wrap}>
            <View style={styles.bars}>
                {heights.map((h, i) => (
                    <View key={i} style={[styles.bar, { height: `${Math.round(h * 100)}%` }]} />
                ))}
            </View>
            <Text style={styles.caption}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: 6 },
    bars: { flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 2 },
    bar: { flex: 1, backgroundColor: colors.accent, borderRadius: 2, minHeight: 3 },
    caption: { color: colors.muted, fontSize: 13 },
});
