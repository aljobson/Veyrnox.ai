import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BarChart } from '../../../components/BarChart';
import { UnlockCard } from '../../../components/UnlockCard';
import { touchTarget } from '../../../lib/a11y';
import { ApiError } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { fetchAccounts, fetchAnalytics, metricLabel, publishErrorMessage, type Analytics, type PublishAccount } from '../../../lib/publish';
import { allowedRanges, delta, percentText, previousBounds, rangeBounds, summarize, thin, type Delta, type RangeDays } from '../../../lib/publishAnalytics';
import { colors } from '../../../theme';
import { usePublishApi } from '../../../lib/usePublishApi';

const CHART_POINTS = 60;

function Stat({ label, value, change }: { label: string; value: string; change: Delta | null }) {
    return (
        <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}${change ? `, ${t('analytics.vsBefore', { change: percentText(change) })}` : ''}`}>
            <Text style={styles.muted}>{label}</Text>
            <Text style={styles.statValue}>{value}</Text>
            {change ? <Text style={[styles.delta, change.change < 0 && styles.down]}>{t('analytics.vsBefore', { change: percentText(change) })}</Text> : null}
        </View>
    );
}

export default function AnalyticsScreen() {
    const api = usePublishApi();
    const [accounts, setAccounts] = useState<PublishAccount[] | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [range, setRange] = useState<RangeDays>(30);
    const [compare, setCompare] = useState(false);
    const [data, setData] = useState<Analytics | null>(null);
    const [prev, setPrev] = useState<Analytics | null>(null);
    const [compareFailed, setCompareFailed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [locked, setLocked] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        fetchAccounts(api)
            .then((r) => {
                setAccounts(r.accounts);
                setAccountId(r.accounts[0]?.id ?? null);
            })
            .catch((err) => setError(publishErrorMessage(err)));
    }, [api]);

    useEffect(() => {
        if (!accountId) return;
        let cancelled = false;
        setData(null);
        setPrev(null);
        setError(null);
        setLocked(false);
        setCompareFailed(false);
        const now = rangeBounds(range);
        fetchAnalytics(api, accountId, now.from, now.to)
            .then((r) => {
                if (cancelled) return;
                setData(r);
                if (!compare) return;
                const before = previousBounds(range);
                fetchAnalytics(api, accountId, before.from, before.to)
                    .then((p) => !cancelled && setPrev(p))
                    .catch(() => !cancelled && setCompareFailed(true));
            })
            .catch((err) => {
                if (cancelled) return;
                if (err instanceof ApiError && err.status === 402) setLocked(true);
                else setError(publishErrorMessage(err));
            });
        return () => {
            cancelled = true;
        };
    }, [api, accountId, range, compare, reload]);

    const summary = useMemo(() => (data ? summarize(data) : null), [data]);
    const before = useMemo(() => (prev ? summarize(prev) : null), [prev]);
    const ranges = allowedRanges(data?.analyticsDays ?? null);
    const latest = data?.days[data.days.length - 1];
    const points = summary ? thin(summary.series, CHART_POINTS) : [];

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: t('analytics.title') }} />
            {locked ? <UnlockCard feature="analytics" onUnlocked={() => setReload((n) => n + 1)} /> : null}
            {!locked && accounts && accounts.length > 1 ? (
                <View style={styles.chips}>
                    {accounts.map((a) => (
                        <Pressable key={a.id} accessibilityRole="button" accessibilityState={{ selected: a.id === accountId }} style={[styles.chip, touchTarget, a.id === accountId && styles.chipOn]} onPress={() => setAccountId(a.id)}>
                            <Text style={[styles.chipText, a.id === accountId && styles.chipTextOn]}>{a.displayName}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {!locked && accounts && accounts.length > 0 ? (
                <View style={styles.chips}>
                    {ranges.map((r) => (
                        <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: r === range }} style={[styles.chip, touchTarget, r === range && styles.chipOn]} onPress={() => setRange(r)}>
                            <Text style={[styles.chipText, r === range && styles.chipTextOn]}>{t('analytics.range', { days: r })}</Text>
                        </Pressable>
                    ))}
                    <Pressable accessibilityRole="button" accessibilityState={{ selected: compare }} style={[styles.chip, touchTarget, compare && styles.chipOn]} onPress={() => setCompare((c) => !c)}>
                        <Text style={[styles.chipText, compare && styles.chipTextOn]}>{t('analytics.compare')}</Text>
                    </Pressable>
                </View>
            ) : null}
            {accounts && accounts.length === 0 ? <Text style={styles.muted}>{t('analytics.connect')}</Text> : null}
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : !locked && (!accounts || (accountId && !data)) ? <ActivityIndicator color={colors.accent} /> : null}
            {data && summary ? (
                <>
                    <Text style={styles.muted}>{t('analytics.last', { days: range })}{data.syncFailing ? ` ${t('analytics.syncFailing')}` : data.lastOkAt ? ` ${t('analytics.updated', { when: new Date(data.lastOkAt).toLocaleString() })}` : ''}</Text>
                    {compare && compareFailed ? <Text style={styles.muted}>{t('analytics.compareFailed')}</Text> : null}
                    <View style={styles.stats}>
                        <Stat label={t('analytics.followers')} value={summary.followers === null ? '–' : summary.followers.toLocaleString()} change={before ? delta(summary.followersChange, before.followersChange) : null} />
                        <Stat label={t('analytics.posts')} value={String(summary.posts)} change={before ? delta(summary.posts, before.posts) : null} />
                        <Stat label={t('analytics.interactions')} value={summary.interactions.toLocaleString()} change={before ? delta(summary.interactions, before.interactions) : null} />
                    </View>
                    {summary.followersChange !== null ? <Text style={styles.muted}>{t('analytics.followersChange', { change: summary.followersChange > 0 ? `+${summary.followersChange.toLocaleString()}` : summary.followersChange.toLocaleString() })}</Text> : null}
                    {points.length > 1 ? (
                        <View style={styles.card}>
                            <BarChart values={points.map((p) => p.value)} label={t('analytics.followersChart', { from: points[0].date, to: points[points.length - 1].date })} summary={t('analytics.chartSummary', { first: points[0].value.toLocaleString(), last: points[points.length - 1].value.toLocaleString() })} />
                        </View>
                    ) : null}
                    {latest ? (
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>{t('analytics.latestDay', { date: latest.date })}</Text>
                            {Object.entries(latest.metrics).map(([k, v]) => (
                                <View key={k} style={styles.metric} accessible accessibilityLabel={`${metricLabel(k)}: ${v}`}>
                                    <Text style={styles.text}>{metricLabel(k)}</Text>
                                    <Text style={styles.value}>{v.toLocaleString()}</Text>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <Text style={styles.muted}>{t('analytics.noNumbers')}</Text>
                    )}
                    {data.posts.slice(0, 20).map((p) => (
                        <View key={p.id} style={styles.card}>
                            <Text style={styles.text} numberOfLines={2}>{p.caption || p.type || t('analytics.post')}</Text>
                            {p.publishedAt ? <Text style={styles.muted}>{new Date(p.publishedAt).toLocaleDateString()}</Text> : null}
                            {Object.entries(p.metrics).slice(0, 4).map(([k, v]) => (
                                <Text key={k} style={styles.small}>{metricLabel(k)}: {v.toLocaleString()}</Text>
                            ))}
                        </View>
                    ))}
                </>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
    statValue: { color: colors.text, fontSize: 20, fontWeight: '700' },
    delta: { color: colors.accent, fontSize: 12 },
    down: { color: colors.danger },
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
    cardTitle: { color: colors.text, fontWeight: '600', fontSize: 16 },
    metric: { flexDirection: 'row', justifyContent: 'space-between' },
    text: { color: colors.text, fontSize: 15 },
    value: { color: colors.money, fontSize: 15, fontWeight: '600' },
    small: { color: colors.body, fontSize: 13 },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger },
});
