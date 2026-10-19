import { StyleSheet, Text, View } from 'react-native';
import { freeLines, type FreeLeft } from '../lib/freeAllowance';
import { colors } from '../theme';

// Renders nothing when the server says the allowance is off, nothing is left, or the read failed (`left` is empty).
export function FreeAllowanceCard({ models, left }: { readonly models: readonly { readonly id: string; readonly name: string }[]; readonly left: FreeLeft }) {
    const lines = freeLines(left, models);
    if (lines.length === 0) return null;
    return (
        <View style={styles.card} accessible accessibilityLabel={`Free today. ${lines.join('. ')}`}>
            <Text style={styles.title} accessibilityRole="header">Free today</Text>
            {lines.map((l) => (
                <Text key={l} style={styles.line}>
                    {l}
                </Text>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 1, borderRadius: 12, padding: 14, gap: 3 },
    title: { color: colors.accent, fontSize: 13, textTransform: 'uppercase', fontWeight: '700' },
    line: { color: colors.text, fontSize: 15 },
});
