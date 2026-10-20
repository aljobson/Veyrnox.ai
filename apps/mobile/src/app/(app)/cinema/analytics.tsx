import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../../auth/AuthProvider';
import { MIN_TARGET } from '../../../lib/a11y';
import { fetchAnalytics, type Analytics } from '../../../lib/cinemaCreator';
import { readOf, type Read } from '../../../lib/cinemaSocial';
import { plural, t } from '../../../lib/i18n';
import { colors } from '../../../theme';

const day = (iso: string) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString() : '');
const ROWS = ['viewers', 'completions', 'voters', 'sharers', 'commenters'] as const;

// A creator's own audience counts for one title over the last 28 days (CINEMA_CREATOR_ANALYTICS_ENABLED). Counts under
// the server's minimum viewer number are hidden by the server, and the screen says so rather than showing zeros.
export default function CreatorAnalytics() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { api } = useAuth();
    const [result, setResult] = useState<Read<Analytics> | null>(null);
    const load = useCallback(async () => {
        setResult(null);
        setResult(await readOf(() => fetchAnalytics(api, id)));
    }, [api, id]);
    useEffect(() => { void load(); }, [load]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('cinemaCreator.analytics.title') }} />
            {!result ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
                : result.kind === 'closed' ? <View style={styles.center}><Text style={styles.muted}>{t('cinemaCreator.analytics.closed')}</Text></View>
                    : result.kind === 'error' ? <Pressable accessibilityRole="button" style={styles.center} onPress={load}><Text style={styles.error}>{t(result.key)} {t('cinemaSocial.tapRetry')}</Text></Pressable>
                        : (
                            <ScrollView contentContainerStyle={styles.content}>
                                <Text style={styles.muted}>{t('cinemaCreator.analytics.period', { from: day(result.value.periodStart), to: day(result.value.periodEnd) })}</Text>
                                {result.value.metrics ? ROWS.map((k) => (
                                    <View key={k} style={styles.row} accessible accessibilityLabel={`${t(`cinemaCreator.analytics.${k}`)}: ${result.value.metrics?.[k]}`}>
                                        <Text style={styles.label}>{t(`cinemaCreator.analytics.${k}`)}</Text>
                                        <Text style={styles.value}>{result.value.metrics?.[k]}</Text>
                                    </View>
                                )) : <Text style={styles.body}>{plural('cinemaCreator.analytics.suppressed', result.value.minimumViewers)}</Text>}
                            </ScrollView>
                        )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    content: { padding: 16, gap: 10 },
    row: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
    label: { color: colors.body, fontSize: 16 },
    value: { color: colors.text, fontSize: 20, fontWeight: '700' },
    body: { color: colors.body, fontSize: 16 },
    muted: { color: colors.muted },
    error: { color: colors.danger },
});
