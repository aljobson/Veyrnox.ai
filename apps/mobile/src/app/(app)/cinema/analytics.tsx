import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Chip } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { ownPublishedTitles } from '../../../lib/cinemaViewer';
import { isTitleId } from '../../../lib/cinemaBrowse';
import { useAuth } from '../../../auth/AuthProvider';
import { MIN_TARGET } from '../../../lib/a11y';
import { fetchAnalytics, type Analytics } from '../../../lib/cinemaCreator';
import { readOf, type Read } from '../../../lib/cinemaSocial';
import { formatLocale, plural, t } from '../../../lib/i18n';
import { colors } from '../../../theme';

const day = (iso: string) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString(formatLocale()) : '');
const ROWS = ['viewers', 'completions', 'voters', 'sharers', 'commenters'] as const;

// A creator's own audience counts for one title over the last 28 days (CINEMA_CREATOR_ANALYTICS_ENABLED). Counts under
// the server's minimum viewer number are hidden by the server, and the screen says so rather than showing zeros.
export default function CreatorAnalytics() {
    const { id } = useLocalSearchParams<{ id?: string }>();
    const { api } = useAuth();
    const [titles, setTitles] = useState<Awaited<ReturnType<typeof ownPublishedTitles>> | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [listError, setListError] = useState<'closed' | 'error' | null>(null);
    const [retry, setRetry] = useState(0);
    const [result, setResult] = useState<Read<Analytics> | null>(null);
    const [metricRetry, setMetricRetry] = useState(0);
    const load = useCallback(() => setMetricRetry(n => n + 1), []);
    useEffect(() => {
        let live = true;
        setTitles(null);
        setSelected(null);
        setListError(null);
        void ownPublishedTitles(api).then(rows => {
            if (!live) return;
            setTitles(rows);
            setSelected(id && isTitleId(id) && rows.some(row => row.id === id) ? id : rows[0]?.id ?? null);
        }).catch(err => { if (live) setListError(err instanceof ApiError && [403, 404, 503].includes(err.status) ? 'closed' : 'error'); });
        return () => { live = false; };
    }, [api, id, retry]);
    useEffect(() => {
        let live = true;
        setResult(null);
        if (selected) void readOf(() => fetchAnalytics(api, selected)).then(value => { if (live) setResult(value); });
        return () => { live = false; };
    }, [api, selected, metricRetry]);

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: t('cinemaCreator.analytics.title') }} />
            {listError === 'closed' ? <Text style={styles.muted}>{t('cinemaCreator.analytics.closed')}</Text>
                : listError === 'error' ? <Button variant="tertiary" label={t('recovery.retry')} onPress={() => setRetry(n => n + 1)} />
                : titles?.length === 0 ? <Text style={styles.body}>{t('cinema.creatorAnalytics.publishATitleToStartSeeing')}</Text> : null}
            {titles?.length ? <View style={{ padding: 16, gap: 8 }}>
                <Text accessibilityRole="header" style={styles.label}>{t('cinema.creatorAnalytics.publishedTitle')}</Text>
                <ScrollView horizontal contentContainerStyle={{ gap: 8 }} accessibilityLabel={t('cinema.creatorAnalytics.publishedTitle')}>
                    {titles.map(title => <Chip key={title.id} label={title.title} selected={selected === title.id} onPress={() => setSelected(title.id)} />)}
                </ScrollView>
            </View> : null}
            {!selected && (listError || titles) ? null : !result ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
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
            {selected ? <Text style={[styles.muted, { padding: 16 }]}>{t('cinema.creatorAnalytics.completionMeansAtLeast90Of')}</Text> : null}
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
