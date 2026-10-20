import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { fetchWinners, readOf, type Read, type WinnerWeek } from '../../lib/cinemaSocial';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// The weekly winners (anonymous, CINEMA_RANKINGS_ENABLED). Off in production: the closed message shows.
export function WinnersList() {
    const router = useRouter();
    const [result, setResult] = useState<Read<WinnerWeek[]> | null>(null);
    const load = useCallback(async () => {
        setResult(null);
        setResult(await readOf(() => fetchWinners()));
    }, []);
    useEffect(() => { void load(); }, [load]);

    if (!result) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
    if (result.kind === 'closed') return <View style={styles.center}><Text style={styles.muted}>{t('cinemaSocial.closed.winners')}</Text></View>;
    if (result.kind === 'error') return <Pressable accessibilityRole="button" style={styles.center} onPress={load}><Text style={styles.error}>{t(result.key)} {t('cinemaSocial.tapRetry')}</Text></Pressable>;
    if (result.value.length === 0) return <View style={styles.center}><Text style={styles.muted}>{t('cinemaSocial.empty.winners')}</Text></View>;
    return (
        <ScrollView contentContainerStyle={styles.list}>
            {result.value.map((w) => (
                <View key={w.id} style={styles.week}>
                    <Text style={styles.heading} accessibilityRole="header">{w.name}</Text>
                    {w.titles.map((x) => (
                        <Pressable key={x.id} accessibilityRole="button" accessibilityLabel={t('cinemaSocial.winnerRow', { rank: x.rank, title: x.title })} style={styles.row} onPress={() => router.push({ pathname: '/cinema/[id]', params: { id: x.id } })}>
                            <Text style={styles.rank}>{x.rank}</Text>
                            <Text style={styles.name} numberOfLines={2}>{x.title}</Text>
                        </Pressable>
                    ))}
                </View>
            ))}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    list: { padding: 12, gap: 18 },
    week: { gap: 8 },
    heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TARGET, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 },
    rank: { color: colors.accent, fontSize: 18, fontWeight: '700', width: 28, textAlign: 'center' },
    name: { color: colors.text, fontSize: 16, flex: 1 },
    muted: { color: colors.muted },
    error: { color: colors.danger },
});
