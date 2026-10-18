import { ApiError, type ApiClient } from '../src/lib/api';
import { fetchInsights, insightsErrorKey, parseInsights, summarizeInsights, MIN_HISTORY_DAYS, MIN_MEASURED_POSTS, MIN_SLOT_POSTS } from '../src/lib/publishInsights';

const base = (o: Record<string, unknown> = {}) => ({
    timezone: 'Europe/London', period_start: '2026-07-27', period_end: '2026-10-19', recorded_posts: 40, measured_posts: 30, history_days: 84, computed_at: '2026-10-18T00:00:00Z',
    heatmap: [{ day: 2, hour: 9, posts: 4, score: 30 }, { day: 5, hour: 18, posts: 6, score: 50 }, { day: 1, hour: 7, posts: 2, score: 90 }, { day: 3, hour: 12, posts: 5, score: 0 }, { day: 8, hour: 1, posts: 9, score: 99 }],
    frequency: [{ week: '2026-10-05', posts: 3, measured_posts: 3, avg_interactions: 10 }, { week: '2026-10-12', posts: 3, measured_posts: 2, avg_interactions: 20 }, { week: '2026-09-28', posts: 0, measured_posts: 0, avg_interactions: null }], ...o,
});

describe('parseInsights', () => {
    test('null insights (not computed yet) is null; a good body keeps its fields', () => {
        expect(parseInsights({ insights: null })).toBeNull();
        expect(parseInsights({})).toBeNull();
        expect(parseInsights({ insights: base() })).toMatchObject({ timezone: 'Europe/London', measuredPosts: 30, recordedPosts: 40, historyDays: 84, periodStart: '2026-07-27', periodEnd: '2026-10-19' });
    });
    test('drops heatmap cells that are out of range', () => {
        const i = parseInsights({ insights: base() });
        expect(i?.cells.map((c) => [c.day, c.hour])).toEqual([[2, 9], [5, 18], [1, 7], [3, 12]]);
    });
    test('missing numbers become zero, never NaN', () => {
        const i = parseInsights({ insights: { timezone: 'UTC', heatmap: [], frequency: [] } });
        expect(i).toMatchObject({ measuredPosts: 0, recordedPosts: 0, historyDays: 0 });
    });
});

describe('summarizeInsights (the web rules)', () => {
    test('needs enough measured posts and history, and ranks slots with enough posts and a positive score', () => {
        const s = summarizeInsights(parseInsights({ insights: base() })!);
        expect(s.enoughHistory).toBe(true);
        expect(s.topSlots.map((c) => [c.day, c.hour, c.score])).toEqual([[5, 18, 50], [2, 9, 30]]);
        expect(MIN_SLOT_POSTS).toBe(3);
        expect(MIN_MEASURED_POSTS).toBe(10);
        expect(MIN_HISTORY_DAYS).toBe(14);
    });
    test('too few measured posts or days gives no recommendation', () => {
        expect(summarizeInsights(parseInsights({ insights: base({ measured_posts: 9 }) })!).topSlots).toEqual([]);
        expect(summarizeInsights(parseInsights({ insights: base({ history_days: 13 }) })!).topSlots).toEqual([]);
    });
    test('ties break by more posts, then earlier day and hour; at most three', () => {
        const heat = [{ day: 4, hour: 9, posts: 3, score: 10 }, { day: 2, hour: 9, posts: 5, score: 10 }, { day: 2, hour: 8, posts: 5, score: 10 }, { day: 1, hour: 1, posts: 3, score: 10 }];
        const s = summarizeInsights(parseInsights({ insights: base({ heatmap: heat }) })!);
        expect(s.topSlots.map((c) => [c.day, c.hour])).toEqual([[2, 8], [2, 9], [1, 1]]);
    });
    test('frequency groups weeks by posts per week and averages by measured posts', () => {
        const s = summarizeInsights(parseInsights({ insights: base() })!);
        expect(s.frequency).toEqual([
            { postsPerWeek: 0, weeks: 1, measuredPosts: 0, score: null },
            { postsPerWeek: 3, weeks: 2, measuredPosts: 5, score: (3 * 10 + 2 * 20) / 5 },
        ]);
    });
});

describe('fetchInsights and errors', () => {
    test('asks for that account only', async () => {
        const request = jest.fn(async () => ({ insights: null }));
        await fetchInsights({ request } as unknown as ApiClient, 'a b');
        expect(request.mock.calls[0]).toEqual(['/api/v1/social/best-time?accountId=a%20b']);
    });
    const k = (s: number, c: string) => insightsErrorKey(new ApiError(s, c, { error: c }));
    test('maps answers to plain keys', () => {
        expect(k(402, 'publish_plan_required')).toBe('insights.err.plan');
        expect(k(503, 'posting_insights_not_open')).toBe('insights.err.notOpen');
        expect(k(404, 'account_not_found')).toBe('insights.err.account');
        expect(k(429, 'rate_limited')).toBe('insights.err.rate');
        expect(k(0, 'network')).toBe('insights.err.network');
        expect(k(502, 'internal')).toBe('common.error');
    });
});
