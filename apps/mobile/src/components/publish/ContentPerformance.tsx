import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { formatLocale, t } from '../../lib/i18n';
import type { AnalyticsPost } from '../../lib/publish';
import { contentTypePerformance, hashtagPerformance, RANK_METRICS, topContent, type RankMetric } from '../../lib/publishAnalyticsDepth';
import { colors } from '../../theme';

export const metricKeys = { interactions: 'publishReporting.interactions', reach: 'publishReporting.reach', impressions: 'publishReporting.impressions',
    views: 'publishReporting.views', likes: 'publishReporting.likes', comments: 'publishReporting.comments', saves: 'publishReporting.saves', shares: 'publishReporting.shares' } as const;
const types: Record<string, string> = { post: 'publishReporting.type.post', image: 'publishReporting.type.image', video: 'publishReporting.type.video' };
export function contentTypeLabel(type: string | null): string {
    const value = type?.trim().toLowerCase() || 'post';
    return Object.hasOwn(types, value) ? t(types[value]) : value;
}
const number = (n: number | null) => n === null ? '–' : n.toLocaleString(formatLocale(), { maximumFractionDigits: 1 });
export function ContentPerformance({ posts }: { posts: readonly AnalyticsPost[] }) {
    const [rank, setRank] = useState<RankMetric>('interactions');
    const metrics = RANK_METRICS.filter(k => k === 'interactions' || posts.some(p => Number.isFinite(p.metrics[k])));
    const chosen = metrics.includes(rank) ? rank : 'interactions';
    const tags = hashtagPerformance(posts);
    return <View style={styles.group}>
        <Text style={styles.title} accessibilityRole="header">{t('publishReporting.performance')}</Text>
        {contentTypePerformance(posts).map(row => <View key={row.type} style={styles.card}>
            <Text style={styles.rowLabel}>{contentTypeLabel(row.type)}</Text>
            <Text style={styles.text}>{t('publishReporting.contentRow', { posts: number(row.posts), interactions: number(row.interactionsPerPost), reach: number(row.reach), views: number(row.views) })}</Text>
        </View>)}
        <Text style={styles.title} accessibilityRole="header">{t('publishReporting.top')}</Text>
        <Text style={styles.text}>{t('publishReporting.rank')}</Text>
        <View style={styles.chips}>{metrics.map(metric => <Pressable key={metric} accessibilityRole="button" accessibilityState={{ selected: chosen === metric }}
            onPress={() => setRank(metric)} style={[styles.chip, touchTarget, chosen === metric && styles.selected]}>
            <Text style={styles.text}>{t(metricKeys[metric])}</Text>
        </Pressable>)}</View>
        {topContent(posts, chosen).map(({ post, value }) => <View key={post.id} style={styles.card}>
            <Text style={styles.text} numberOfLines={3}>{post.caption || contentTypeLabel(post.type)}</Text>
            <Text style={styles.text}>{t(metricKeys[chosen])}: {number(value)}</Text>
        </View>)}
        {tags.length ? <><Text style={styles.title} accessibilityRole="header">{t('publishReporting.hashtags')}</Text>
            {tags.map(row => <View key={row.hashtag} style={styles.card}>
                <Text style={styles.rowLabel} numberOfLines={2}>{row.hashtag}</Text>
                <Text style={styles.text}>{t('publishReporting.hashtagRow', { posts: number(row.posts), interactions: number(row.interactionsPerPost) })}</Text>
            </View>)}</> : null}
    </View>;
}
const styles = StyleSheet.create({
    group: { gap: 10 }, card: { padding: 14, gap: 6, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    rowLabel: { color: colors.text, fontWeight: '600', fontSize: 16 },
    title: { color: colors.text, fontWeight: '600', fontSize: 16 }, text: { color: colors.body },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border },
    selected: { borderColor: colors.accent, backgroundColor: colors.surface },
});
