import { StyleSheet, Text, View } from 'react-native';
import { formatLocale, t } from '../../lib/i18n';
import { delta, percentText } from '../../lib/publishAnalytics';
import { summarizePortfolio, type AnalyticsEntry } from '../../lib/publishAnalyticsDepth';
import { colors } from '../../theme';

const fields = { followers: 'publishReporting.audience', posts: 'publishReporting.content', interactions: 'publishReporting.interactions',
    reach: 'publishReporting.reach', impressions: 'publishReporting.impressions', views: 'publishReporting.views', staleAccounts: 'publishReporting.attention' } as const;
const number = (n: number | null) => n === null ? '–' : n.toLocaleString(formatLocale());
export function AnalyticsPortfolio({ entries, previous, failed, includeContent, compare }: {
    entries: AnalyticsEntry[]; previous: AnalyticsEntry[]; failed: number; includeContent: boolean; compare: boolean;
}) {
    const summary = summarizePortfolio(entries);
    const matched = entries.filter(e => previous.some(p => p.account.id === e.account.id));
    const currentMatched = summarizePortfolio(matched);
    const before = summarizePortfolio(previous.filter(p => matched.some(e => e.account.id === p.account.id)));
    return <View style={styles.group}>
        {failed ? <Text style={styles.muted}>{t('publishReporting.failed', { count: failed })}</Text> : null}
        <Text style={styles.title} accessibilityRole="header">{t('publishReporting.all')}</Text>
        <View style={styles.stats}>{(Object.keys(fields) as (keyof typeof fields)[]).map(key => <View key={key} style={styles.card}>
            <Text style={styles.muted}>{t(fields[key])}</Text><Text style={styles.value}>{number(summary[key])}</Text>
        </View>)}</View>
        {compare ? <View style={styles.group}>
            <Text style={styles.title} accessibilityRole="header">{t('publishReporting.comparedAccounts', { count: matched.length })}</Text>
            <View style={styles.stats}>{matched.length ? (Object.keys(fields) as (keyof typeof fields)[]).map(key => {
                const change = delta(currentMatched[key], before[key]);
                return <View key={key} style={styles.card}><Text style={styles.muted}>{t(fields[key])}</Text>
                    <Text style={styles.text}>{change ? percentText(change) : '–'}</Text></View>;
            }) : <Text style={styles.muted}>{t('analytics.compareFailed')}</Text>}</View>
        </View> : null}
        {includeContent ? summary.rows.map(row => <View key={row.account.id} style={styles.card}>
            <Text style={styles.rowLabel}>{row.account.displayName}</Text>
            <Text style={styles.muted}>{row.account.network}</Text>
            <Text style={styles.text}>{t('publishReporting.accountRow', { audience: number(row.summary.followers), posts: number(row.summary.posts), interactions: number(row.summary.interactions) })}</Text>
            <Text style={styles.text}>{t('publishReporting.metricsRow', { reach: number(row.reach), impressions: number(row.impressions), views: number(row.views) })}</Text>
            {row.failing || !row.lastOkAt ? <Text style={styles.muted}>{t('publishReporting.attention')}</Text> : null}
        </View>) : null}
    </View>;
}
const styles = StyleSheet.create({ group: { gap: 10 }, stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    card: { padding: 14, gap: 6, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    rowLabel: { color: colors.text, fontWeight: '600', fontSize: 16 },
    title: { color: colors.text, fontWeight: '600', fontSize: 16 }, value: { color: colors.text, fontSize: 20, fontWeight: '700' },
    text: { color: colors.body }, muted: { color: colors.muted, fontSize: 13 } });
