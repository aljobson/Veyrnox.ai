import type { Analytics } from './publish';

// ADR-0150: analytics range, compare and the followers chart. The summary rules mirror the web's
// lib/social/analyticsSummary.js so the phone and the site show the same numbers for the same data.

export const RANGE_OPTIONS = [7, 30, 90, 365] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];

const day = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

// The last `days` days ending today (UTC, inclusive), and the same number of days immediately before them.
export function rangeBounds(days: number, now: Date = new Date()): { from: string; to: string } {
    return { from: day(new Date(now.getTime() - (days - 1) * DAY_MS)), to: day(now) };
}
export function previousBounds(days: number, now: Date = new Date()): { from: string; to: string } {
    const end = new Date(now.getTime() - days * DAY_MS);
    return rangeBounds(days, end);
}

// Ranges the plan allows. The server sends analyticsDays when plans are on; 0 or missing means no cap is known.
export function allowedRanges(analyticsDays: number | null): RangeDays[] {
    const cap = analyticsDays && analyticsDays > 0 ? analyticsDays : Infinity;
    const ok = RANGE_OPTIONS.filter((r) => r <= cap);
    return ok.length > 0 ? ok : [RANGE_OPTIONS[0]];
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export const postInteractions = (metrics: Record<string, number>): number => count(metrics.likes) + count(metrics.comments) + count(metrics.saves) + count(metrics.shares);

export interface Summary {
    readonly followers: number | null;
    readonly followersChange: number | null;
    readonly posts: number;
    readonly interactions: number;
    readonly series: readonly { date: string; value: number }[];
}

export function summarize(a: Pick<Analytics, 'days' | 'posts'>): Summary {
    const series = a.days.filter((d) => Number.isFinite(d.metrics.followers)).map((d) => ({ date: d.date, value: d.metrics.followers }));
    const followers = series.length ? series[series.length - 1].value : null;
    return {
        followers,
        // A change needs two different days to compare.
        followersChange: series.length > 1 && followers !== null ? followers - series[0].value : null,
        posts: a.posts.length,
        interactions: a.posts.reduce((sum, p) => sum + postInteractions(p.metrics), 0),
        series,
    };
}

export interface Delta {
    readonly change: number;
    // null when the earlier number was 0, so no percentage can be told.
    readonly percent: number | null;
}

export function delta(current: number | null, previous: number | null): Delta | null {
    if (current === null || previous === null) return null;
    const change = current - previous;
    return { change, percent: previous === 0 ? null : (change / previous) * 100 };
}

export const signed = (n: number): string => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());
export const percentText = (d: Delta): string => (d.percent === null ? signed(d.change) : `${signed(d.change)} (${d.percent > 0 ? '+' : ''}${d.percent.toFixed(1)}%)`);

// Bar heights 0..1 for a chart. A flat series draws as even bars so it never divides by zero.
export function barHeights(values: readonly number[]): number[] {
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min) return values.map(() => 0.5);
    return values.map((v) => 0.1 + 0.9 * ((v - min) / (max - min)));
}

// At most `max` points, taking evenly spaced ones and always the last, so a year of days fits a phone chart.
export function thin<T>(items: readonly T[], max: number): T[] {
    if (items.length <= max) return [...items];
    const out: T[] = [];
    for (let i = 0; i < max - 1; i += 1) out.push(items[Math.floor((i * items.length) / (max - 1))]);
    out.push(items[items.length - 1]);
    return out;
}
