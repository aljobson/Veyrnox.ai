import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { fetchFreeAllowance, freeLines } from '../lib/freeAllowance';
import { colors } from '../theme';

// Renders nothing when the server says the allowance is off, nothing is left, or the read fails.
export function FreeAllowanceCard({ models }: { readonly models: readonly { readonly id: string; readonly name: string }[] }) {
    const { api } = useAuth();
    const [lines, setLines] = useState<string[]>([]);
    const ids = models.map((m) => m.id).join(',');

    useEffect(() => {
        let live = true;
        fetchFreeAllowance(api)
            .then((left) => live && setLines(freeLines(left, models)))
            .catch(() => live && setLines([]));
        return () => {
            live = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, ids]);

    if (lines.length === 0) return null;
    return (
        <View style={styles.card} accessible accessibilityLabel={`Free today. ${lines.join('. ')}`}>
            <Text style={styles.title}>Free today</Text>
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
