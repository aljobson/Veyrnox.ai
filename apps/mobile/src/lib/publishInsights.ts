import { ApiError, type ApiClient } from './api';

// Best time to post, read-only (ADR-0138): GET /api/v1/social/best-time for one account. The evidence rules are the
// web's own (lib/social/postingInsights.js) so the phone never recommends a time the site would not: a slot needs
// enough measured posts, the account needs enough history, and a slot with no interactions is never ranked. This is
// past performance only; it does not predict audience activity.

export const MIN_SLOT_POSTS = 3;
export const MIN_MEASURED_POSTS = 10;
export const MIN_HISTORY_DAYS = 14;

export interface HeatCell {
    readonly day: number; // 1 Monday to 7 Sunday, in the brand's time zone
    readonly hour: number; // 0 to 23, in the brand's time zone
    readonly posts: number;
    readonly score: number | null;
}
export interface WeekRow {
    readonly posts: number;
    readonly measuredPosts: number;
    readonly avg: number | null;
}
export interface Insights {
    readonly timezone: string;
    readonly periodStart: string | null;
    readonly periodEnd: string | null;
    readonly recordedPosts: number;
    readonly measuredPosts: number;
    readonly historyDays: number;
    readonly cells: readonly HeatCell[];
    readonly weeks: readonly WeekRow[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const score = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const date = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function parseInsights(body: unknown): Insights | null {
    const i = isObject(body) ? body.insights : null;
    if (!isObject(i)) return null;
    const cells: HeatCell[] = [];
    for (const c of Array.isArray(i.heatmap) ? i.heatmap : []) {
        if (!isObject(c)) continue;
        const { day, hour, posts } = c;
        if (!Number.isInteger(day) || (day as number) < 1 || (day as number) > 7 || !Number.isInteger(hour) || (hour as number) < 0 || (hour as number) > 23 || !Number.isInteger(posts) || (posts as number) < 0) continue;
        cells.push({ day: day as number, hour: hour as number, posts: posts as number, score: score(c.score) });
    }
    const weeks: WeekRow[] = [];
    for (const w of Array.isArray(i.frequency) ? i.frequency : []) {
        if (!isObject(w) || !Number.isInteger(w.posts) || (w.posts as number) < 0 || !Number.isInteger(w.measured_posts) || (w.measured_posts as number) < 0 || (w.measured_posts as number) > (w.posts as number)) continue;
        weeks.push({ posts: w.posts as number, measuredPosts: w.measured_posts as number, avg: score(w.avg_interactions) });
    }
    return {
        timezone: typeof i.timezone === 'string' && i.timezone ? i.timezone : 'UTC',
        periodStart: date(i.period_start),
        periodEnd: date(i.period_end),
        recordedPosts: count(i.recorded_posts),
        measuredPosts: count(i.measured_posts),
        historyDays: count(i.history_days),
        cells,
        weeks,
    };
}

export interface FrequencyGroup {
    readonly postsPerWeek: number;
    readonly weeks: number;
    readonly measuredPosts: number;
    readonly score: number | null;
}

export function summarizeInsights(i: Insights): { enoughHistory: boolean; topSlots: HeatCell[]; frequency: FrequencyGroup[] } {
    const enoughHistory = i.measuredPosts >= MIN_MEASURED_POSTS && i.historyDays >= MIN_HISTORY_DAYS;
    const topSlots = enoughHistory
        ? i.cells
              .filter((c) => c.posts >= MIN_SLOT_POSTS && c.score !== null && c.score > 0)
              .sort((a, b) => (b.score as number) - (a.score as number) || b.posts - a.posts || a.day - b.day || a.hour - b.hour)
              .slice(0, 3)
        : [];
    const groups = new Map<number, { weeks: number; measuredPosts: number; interactions: number }>();
    for (const w of i.weeks) {
        const g = groups.get(w.posts) ?? { weeks: 0, measuredPosts: 0, interactions: 0 };
        g.weeks += 1;
        if (w.measuredPosts > 0 && w.avg !== null) {
            g.measuredPosts += w.measuredPosts;
            g.interactions += w.avg * w.measuredPosts;
        }
        groups.set(w.posts, g);
    }
    const frequency = [...groups.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([postsPerWeek, g]) => ({ postsPerWeek, weeks: g.weeks, measuredPosts: g.measuredPosts, score: g.measuredPosts ? g.interactions / g.measuredPosts : null }));
    return { enoughHistory, topSlots, frequency };
}

export async function fetchInsights(api: ApiClient, accountId: string): Promise<Insights | null> {
    return parseInsights(await api.request(`/api/v1/social/best-time?accountId=${encodeURIComponent(accountId)}`));
}

// Catalog keys for what the person should know, looked up when shown.
export function insightsErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'insights.err.network';
    if (err.status === 429) return 'insights.err.rate';
    if (err.status === 402) return 'insights.err.plan';
    if (err.status === 404) return 'insights.err.account';
    if (err.status === 503) return 'insights.err.notOpen';
    return 'common.error';
}
