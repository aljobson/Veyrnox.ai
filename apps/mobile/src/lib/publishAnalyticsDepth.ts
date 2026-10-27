import type { Analytics, AnalyticsPost, PublishAccount } from './publish';
import { summarize, postInteractions, type RangeDays } from './publishAnalytics';

// Port of lib/social/analyticsSummary.js. Provider absence is never a synthetic zero.
export const ANALYTICS_CAPABILITIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
    instagram: ['Followers', 'Posts', 'Interactions', 'Reach', 'Views', 'Best time'],
    youtube: ['Subscribers', 'Videos', 'Interactions', 'Views', 'Best time'],
    tiktok: ['Followers', 'Videos', 'Interactions', 'Views', 'Best time'],
    twitter: ['Followers', 'Posts', 'Interactions', 'Impressions', 'Best time'],
    twitch: ['Videos', 'Views'],
});
export const hasAnalytics = (network: string): boolean => Object.hasOwn(ANALYTICS_CAPABILITIES, network);
export const RANK_METRICS = ['interactions', 'reach', 'impressions', 'views', 'likes', 'comments', 'saves', 'shares'] as const;
export type RankMetric = typeof RANK_METRICS[number];
export function totalPostMetric(posts: readonly AnalyticsPost[], key: string): number | null {
    const values = posts.map(p => p.metrics[key]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}
export function contentTypePerformance(posts: readonly AnalyticsPost[]) {
    const groups = new Map<string, AnalyticsPost[]>();
    for (const post of posts) {
        const type = post.type?.trim().toLowerCase() || 'post';
        groups.set(type, [...(groups.get(type) ?? []), post]);
    }
    return [...groups].map(([type, items]) => {
        const interactions = items.reduce((sum, p) => sum + postInteractions(p.metrics), 0);
        return { type, posts: items.length, interactions, interactionsPerPost: interactions / items.length,
            reach: totalPostMetric(items, 'reach'), impressions: totalPostMetric(items, 'impressions'), views: totalPostMetric(items, 'views') };
    }).sort((a, b) => b.posts - a.posts || b.interactions - a.interactions || a.type.localeCompare(b.type));
}
export function topContent(posts: readonly AnalyticsPost[], metric: string = 'interactions', limit = 5) {
    if (!RANK_METRICS.includes(metric as RankMetric) || !Number.isInteger(limit) || limit < 1 || limit > 50) return [];
    return posts.map(post => ({ post, value: metric === 'interactions' ? postInteractions(post.metrics) : post.metrics[metric] }))
        .filter(row => Number.isFinite(row.value))
        .sort((a, b) => b.value - a.value || (b.post.publishedAt || '').localeCompare(a.post.publishedAt || '')).slice(0, limit);
}
// Construct once, rather than using a Unicode literal that older Hermes parsers cannot load.
export function createHashtagRegex(make: (source: string, flags: string) => RegExp = (source, flags) => new RegExp(source, flags)): RegExp {
    try { return make('#[\\p{L}\\p{N}_]+', 'gu'); } catch { return /#[0-9A-Za-z_À-￿]+/g; }
}
const hashtagRegex = createHashtagRegex();
export function hashtagPerformance(posts: readonly AnalyticsPost[], limit = 10, regex = hashtagRegex) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return [];
    const tags = new Map<string, { hashtag: string; posts: number; interactions: number }>();
    for (const post of posts) {
        for (const tag of new Set((post.caption.match(regex) ?? []).map(value => value.toLocaleLowerCase()))) {
            const row = tags.get(tag) ?? { hashtag: tag, posts: 0, interactions: 0 };
            row.posts += 1; row.interactions += postInteractions(post.metrics); tags.set(tag, row);
        }
    }
    return [...tags.values()].map(row => ({ ...row, interactionsPerPost: row.interactions / row.posts }))
        .sort((a, b) => b.interactionsPerPost - a.interactionsPerPost || b.posts - a.posts || a.hashtag.localeCompare(b.hashtag)).slice(0, limit);
}
export interface AnalyticsEntry { account: PublishAccount; data: Analytics }
export function summarizePortfolio(entries: readonly AnalyticsEntry[]) {
    const rows = entries.map(({ account, data }) => {
        const base = summarize(data);
        const interactionsPerPost = base.posts ? base.interactions / base.posts : null;
        const summary = { ...base, interactionsPerPost,
            engagementPer1000: interactionsPerPost !== null && base.followers ? interactionsPerPost / base.followers * 1000 : null,
            hasInsights: totalPostMetric(data.posts, 'reach') !== null, hasViews: totalPostMetric(data.posts, 'views') !== null,
            hasImpressions: totalPostMetric(data.posts, 'impressions') !== null,
            series: base.series.map(p => ({ date: p.date, followers: p.value })) };
        return { account, summary, views: totalPostMetric(data.posts, 'views'), impressions: totalPostMetric(data.posts, 'impressions'),
            reach: totalPostMetric(data.posts, 'reach'), lastOkAt: data.lastOkAt, failing: data.syncFailing };
    });
    const sum = (values: (number | null)[]) => {
        const present = values.filter((n): n is number => n !== null);
        return present.length ? present.reduce((a, b) => a + b, 0) : null;
    };
    return { accounts: rows.length, followers: sum(rows.map(r => r.summary.followers)),
        posts: rows.reduce((s, r) => s + r.summary.posts, 0), interactions: rows.reduce((s, r) => s + r.summary.interactions, 0),
        views: sum(rows.map(r => r.views)), impressions: sum(rows.map(r => r.impressions)), reach: sum(rows.map(r => r.reach)),
        staleAccounts: rows.filter(r => r.failing || !r.lastOkAt).length, rows };
}
export function csvCell(value: unknown): string {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
const csv = (lines: unknown[][]) => lines.map(line => line.map(csvCell).join(',')).join('\r\n');
const accountLabel = (a: PublishAccount) => a.rawDisplayName || a.externalAccountId || '';
export function analyticsCsv(rows: ReturnType<typeof summarizePortfolio>['rows']): string {
    return csv([['network', 'account', 'followers', 'posts', 'interactions', 'reach', 'impressions', 'views', 'last_updated', 'status'],
        ...rows.map(r => [r.account.network, accountLabel(r.account), r.summary.followers, r.summary.posts, r.summary.interactions,
            r.reach, r.impressions, r.views, r.lastOkAt, r.failing ? 'update_failed' : r.lastOkAt ? 'current' : 'awaiting_first_sync'])]);
}
export function postAnalyticsCsv(account: PublishAccount, posts: readonly AnalyticsPost[]): string {
    return csv([['network', 'account', 'published_at', 'type', 'caption', 'permalink', 'reach', 'impressions', 'views', 'likes', 'comments', 'saves', 'shares', 'interactions'],
        ...posts.map(p => [account.network, accountLabel(account), p.publishedAt, p.type, p.caption, p.link,
            ...['reach', 'impressions', 'views', 'likes', 'comments', 'saves', 'shares'].map(k => Number.isFinite(p.metrics[k]) ? p.metrics[k] : null), postInteractions(p.metrics)])]);
}
export const contentCsvName = (network: string) => `veyrnox-${/^[a-z]+$/.test(network) ? network : 'account'}-content.csv`;
export const portfolioCsvName = (from: string, to: string) => `veyrnox-analytics-${from}-to-${to}.csv`;
export function reportOptions(params: Record<string, string | string[] | undefined>) {
    const first = (key: string) => { const v = params[key]; return Array.isArray(v) ? v[0] : v; };
    const days = Number(first('days'));
    const accent = first('accent') || '';
    return { days: ([7, 30, 90, 365].includes(days) ? days : 30) as RangeDays,
        compare: first('compare') === '1', account: first('account') || '', includeContent: first('content') !== '0',
        title: (first('reportTitle') || '').slice(0, 100), accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : '#38bdf8' };
}
