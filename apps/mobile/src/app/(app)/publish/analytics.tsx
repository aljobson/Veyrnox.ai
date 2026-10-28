import { Stack, useLocalSearchParams } from 'expo-router';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BarChart } from '../../../components/BarChart';
import { UnlockCard } from '../../../components/UnlockCard';
import { touchTarget } from '../../../lib/a11y';
import { ApiError } from '../../../lib/api';
import { formatLocale, t } from '../../../lib/i18n';
import { fetchAccounts, fetchAnalytics, metricLabel, publishErrorMessage, type Analytics, type PublishAccount } from '../../../lib/publish';
import { allowedRanges, delta, percentText, previousBounds, rangeBounds, summarize, thin, type Delta, type RangeDays } from '../../../lib/publishAnalytics';
import { colors } from '../../../theme';
import { usePublishApi } from '../../../lib/usePublishApi';
import { exportDirectory } from '../../../lib/appCache';
import { AnalyticsPortfolio } from '../../../components/publish/AnalyticsPortfolio';
import { ContentPerformance, contentTypeLabel } from '../../../components/publish/ContentPerformance';
import { analyticsCsv, contentCsvName, hasAnalytics, portfolioCsvName, postAnalyticsCsv, reportOptions, summarizePortfolio, type AnalyticsEntry } from '../../../lib/publishAnalyticsDepth';
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
    const params = useLocalSearchParams();
    const options = reportOptions(params);
    const [entries, setEntries] = useState<AnalyticsEntry[]>([]);
    const [previous, setPrevious] = useState<AnalyticsEntry[]>([]);
    const [accountSource, setAccountSource] = useState<typeof api | null>(null);
    const [loadedBounds, setLoadedBounds] = useState(() => rangeBounds(options.days));
    const [failed, setFailed] = useState(0);
    const [loading, setLoading] = useState(false);
    const [csvBusy, setCsvBusy] = useState(false);
    const [csvNotice, setCsvNotice] = useState<string | null>(null);
    const csvFile = useRef<File | null>(null);
    const sharing = useRef(false);
    const cleanupCsv = () => { try { if (csvFile.current?.exists) csvFile.current.delete(); } catch { /* Sign-out also clears this directory. */ } csvFile.current = null; };
    useEffect(() => () => cleanupCsv(), [api]);
    const [accounts, setAccounts] = useState<PublishAccount[] | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [range, setRange] = useState<RangeDays>(options.days);
    const [compare, setCompare] = useState(options.compare);
    const [data, setData] = useState<Analytics | null>(null);
    const [prev, setPrev] = useState<Analytics | null>(null);
    const [compareFailed, setCompareFailed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [locked, setLocked] = useState(false);
    const [reload, setReload] = useState(0);
    const [accountsReload, setAccountsReload] = useState(0);

    useEffect(() => { setRange(options.days); setCompare(options.compare); }, [options.days, options.compare]);
    useEffect(() => {
        let cancelled = false;
        setAccountSource(null); setAccounts(null); setAccountId(null); setData(null); setPrev(null); setEntries([]); setPrevious([]); setError(null); setLocked(false); setLoading(false);
        fetchAccounts(api).then(r => {
            if (cancelled) return;
            const supported = r.accounts.filter(a => a.status === 'active' && hasAnalytics(a.network));
            setAccountSource(api); setAccounts(supported);
            setAccountId(supported.some(a => a.id === options.account) ? options.account : supported.length >= 2 ? '' : supported[0]?.id ?? null);
        }).catch(err => { if (!cancelled) setError(publishErrorMessage(err)); });
        return () => { cancelled = true; };
    }, [api, options.account, accountsReload]);

    useEffect(() => {
        if (accountSource !== api || accountId === null || !accounts) return;
        let cancelled = false;
        setData(null); setPrev(null); setEntries([]); setPrevious([]); setError(null); setLocked(false);
        setCompareFailed(false); setFailed(0); setLoading(true); setCsvNotice(null);
        const now = rangeBounds(range), before = previousBounds(range);
        const selected = accountId ? accounts.filter(a => a.id === accountId) : accounts;
        const requests = selected.flatMap(account => [
            { account, previous: false, bounds: now }, ...(compare ? [{ account, previous: true, bounds: before }] : []),
        ]);
        void Promise.allSettled(requests.map(r => fetchAnalytics(api, r.account.id, r.bounds.from, r.bounds.to))).then(results => {
            if (cancelled) return;
            const current: AnalyticsEntry[] = [], prior: AnalyticsEntry[] = [];
            let failures = 0, comparisonFailed = false;
            let firstFailure: unknown;
            const lockedResult = results.some(r => r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 402);
            setLoading(false);
            if (lockedResult) { setLocked(true); return; }
            results.forEach((result, i) => {
                if (result.status === 'fulfilled') (requests[i].previous ? prior : current).push({ account: requests[i].account, data: result.value });
                else if (requests[i].previous) comparisonFailed = true;
                else { if (failures === 0) firstFailure = result.reason; failures++; }
            });
            const caps = [...current, ...prior].map(e => e.data.analyticsDays).filter((n): n is number => n !== null);
            const allowed = allowedRanges(caps.length ? Math.min(...caps) : null);
            const clamped = [...allowed].reverse().find(r => r <= range) ?? allowed[0];
            if (clamped !== range) { setRange(clamped); return; }
            setLoadedBounds(now); setEntries(current); setPrevious(prior); setFailed(failures); setCompareFailed(comparisonFailed);
            if (accountId) { setData(current[0]?.data ?? null); setPrev(prior[0]?.data ?? null); }
            if (!current.length) setError(selected.length === 1 ? publishErrorMessage(firstFailure) : t('publishReporting.loadFailed'));
        });
        return () => { cancelled = true; };
    }, [api, accountSource, accounts, accountId, range, compare, reload]);

    async function exportCsv() {
        if (sharing.current || !entries.length || accountSource !== api) return;
        sharing.current = true; setCsvBusy(true); setCsvNotice(null);
        try {
            const directory = exportDirectory();
            directory.create({ intermediates: true, idempotent: true });
            const bounds = loadedBounds;
            const name = accountId ? contentCsvName(entries[0].account.network) : portfolioCsvName(bounds.from, bounds.to);
            const file = new File(directory, name); csvFile.current = file;
            if (file.exists) file.delete();
            file.create();
            file.write(accountId ? postAnalyticsCsv(entries[0].account, entries[0].data.posts) : analyticsCsv(summarizePortfolio(entries).rows));
            await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
        } catch { setCsvNotice(t('publishReporting.csvFailed')); }
        finally { cleanupCsv(); sharing.current = false; setCsvBusy(false); }
    }

    const summary = useMemo(() => (data ? summarize(data) : null), [data]);
    const before = useMemo(() => (prev ? summarize(prev) : null), [prev]);
    const caps = entries.map(e => e.data.analyticsDays).filter((n): n is number => n !== null);
    const ranges = allowedRanges(caps.length ? Math.min(...caps) : null);
    const latest = data?.days[data.days.length - 1];
    const points = summary ? thin(summary.series, CHART_POINTS) : [];

    if (accountSource !== api && !error) return <View style={styles.screen}><Stack.Screen options={{ title: t('analytics.title') }} /><ActivityIndicator color={colors.accent} /></View>;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Stack.Screen options={{ title: t('analytics.title') }} />
            {options.title ? <View style={[styles.card, { borderStartWidth: 4, borderStartColor: options.accent }]}><Text accessibilityRole="header" style={styles.cardTitle}>{options.title}</Text></View> : null}
            {locked ? <UnlockCard feature="analytics" onUnlocked={() => setReload((n) => n + 1)} /> : null}
            {!locked && accounts && accounts.length > 1 ? (
                <View style={styles.chips}>
                    <Pressable accessibilityRole="button" accessibilityState={{ selected: accountId === '' }} style={[styles.chip, touchTarget, accountId === '' && styles.chipOn]} onPress={() => setAccountId('')}>
                        <Text style={[styles.chipText, accountId === '' && styles.chipTextOn]}>{t('publishReporting.all')}</Text>
                    </Pressable>
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
            {error ? <View><Text style={styles.error} accessibilityRole="alert">{error}</Text><Pressable accessibilityRole="button" style={touchTarget} onPress={() => accounts ? setReload(n => n + 1) : setAccountsReload(n => n + 1)}><Text style={styles.text}>{t('publishReporting.retry')}</Text></Pressable></View> : !locked && (!accounts || loading) ? <ActivityIndicator color={colors.accent} /> : null}
            {!locked && entries.length ? <>
                <Pressable accessibilityRole="button" accessibilityLabel={t('publishReporting.csvFor', { name: accountId ? entries[0].account.displayName : t('publishReporting.all') })}
                    accessibilityState={{ disabled: csvBusy, busy: csvBusy }} disabled={csvBusy} style={[styles.chip, touchTarget]} onPress={exportCsv}>
                    <Text style={styles.text}>{t('publishReporting.csv')}</Text>
                </Pressable>
                {csvBusy ? <Text style={styles.muted} accessibilityLiveRegion="polite">{t('publishReporting.sharing')}</Text> : null}
                {csvNotice ? <Text style={styles.muted} accessibilityLiveRegion="polite">{csvNotice}</Text> : null}
                {accountId === '' ? <AnalyticsPortfolio entries={entries} previous={previous} failed={failed} includeContent={options.includeContent} compare={compare} /> : null}
            </> : null}
            {data && summary ? (
                <>
                    <Text style={styles.muted}>{t('analytics.last', { days: range })}{data.syncFailing ? ` ${t('analytics.syncFailing')}` : data.lastOkAt ? ` ${t('analytics.updated', { when: new Date(data.lastOkAt).toLocaleString(formatLocale()) })}` : ''}</Text>
                    {compare && compareFailed ? <Text style={styles.muted}>{t('analytics.compareFailed')}</Text> : null}
                    <View style={styles.stats}>
                        <Stat label={t('analytics.followers')} value={summary.followers === null ? '–' : summary.followers.toLocaleString(formatLocale())} change={before ? delta(summary.followersChange, before.followersChange) : null} />
                        <Stat label={t('analytics.posts')} value={String(summary.posts)} change={before ? delta(summary.posts, before.posts) : null} />
                        <Stat label={t('analytics.interactions')} value={summary.interactions.toLocaleString(formatLocale())} change={before ? delta(summary.interactions, before.interactions) : null} />
                    </View>
                    {summary.followersChange !== null ? <Text style={styles.muted}>{t('analytics.followersChange', { change: summary.followersChange > 0 ? `+${summary.followersChange.toLocaleString(formatLocale())}` : summary.followersChange.toLocaleString(formatLocale()) })}</Text> : null}
                    {points.length > 1 ? (
                        <View style={styles.card}>
                            <BarChart values={points.map((p) => p.value)} label={t('analytics.followersChart', { from: points[0].date, to: points[points.length - 1].date })} summary={t('analytics.chartSummary', { first: points[0].value.toLocaleString(formatLocale()), last: points[points.length - 1].value.toLocaleString(formatLocale()) })} />
                        </View>
                    ) : null}
                    {latest ? (
                        <View style={styles.card}>
                            <Text accessibilityRole="header" style={styles.cardTitle}>{t('analytics.latestDay', { date: latest.date })}</Text>
                            {Object.entries(latest.metrics).map(([k, v]) => (
                                <View key={k} style={styles.metric} accessible accessibilityLabel={`${metricLabel(k)}: ${v}`}>
                                    <Text style={styles.text}>{metricLabel(k)}</Text>
                                    <Text style={styles.value}>{v.toLocaleString(formatLocale())}</Text>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <Text style={styles.muted}>{t('analytics.noNumbers')}</Text>
                    )}
                    {options.includeContent ? data.posts.slice(0, 20).map(p => (
                        <View key={p.id} style={styles.card}>
                            <Text style={styles.text} numberOfLines={2}>{p.caption || contentTypeLabel(p.type)}</Text>
                            {p.publishedAt ? <Text style={styles.muted}>{new Date(p.publishedAt).toLocaleDateString(formatLocale())}</Text> : null}
                            {Object.entries(p.metrics).slice(0, 4).map(([key, value]) => <Text key={key} style={styles.small}>{metricLabel(key)}: {value.toLocaleString(formatLocale())}</Text>)}
                        </View>
                    )) : null}
                    {options.includeContent && data.posts.length ? <ContentPerformance key={accountId} posts={data.posts} /> : null}
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
