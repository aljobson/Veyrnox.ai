import { ApiError, type ApiClient } from './api';
import { parsePost, type PublishPost } from './publish';

// Publish calendar, read-only (ADR-0138): a week at a time of the person's scheduled, published, failed and canceled
// posts from GET /api/v1/social/calendar. Rows are the same shape as the posts list plus three action flags, so a tap
// opens the existing post screen, which already owns cancel, restore and reschedule. Times are shown in the phone's
// own time zone, like the rest of the app.

export interface CalendarPost extends PublishPost {
    readonly canReschedule: boolean;
    readonly canCancel: boolean;
    readonly canRestore: boolean;
}

export interface CalendarCursor {
    readonly at: string;
    readonly id: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseCalendar(body: unknown): { posts: CalendarPost[]; next: CalendarCursor | null } {
    if (!isObject(body)) return { posts: [], next: null };
    const posts: CalendarPost[] = [];
    if (Array.isArray(body.posts)) {
        for (const raw of body.posts) {
            const post = parsePost(raw);
            if (!post || !isObject(raw)) continue;
            posts.push({ ...post, canReschedule: raw.can_reschedule === true, canCancel: raw.can_cancel === true, canRestore: raw.can_restore === true });
        }
    }
    const n = body.next;
    const next = isObject(n) && typeof n.at === 'string' && n.at && typeof n.id === 'string' && n.id ? { at: n.at, id: n.id } : null;
    return { posts, next };
}

// Monday 00:00 to the next Monday 00:00 in local time, `offsetWeeks` away from the week holding `now`. Built with
// calendar arithmetic, so a week with a clock change is still one local week. Always far under the server's 43 days.
export function weekBounds(now: Date, offsetWeeks: number): { start: Date; end: Date } {
    const sinceMonday = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - sinceMonday + 7 * offsetWeeks);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return { start, end };
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export interface DayGroup {
    readonly key: string;
    readonly date: Date;
    readonly posts: readonly CalendarPost[];
}

// Posts without a date are left out; the rest are grouped by local day, earliest first.
export function dayGroups(posts: readonly CalendarPost[]): DayGroup[] {
    const dated = posts
        .filter((p) => p.scheduledAt && !Number.isNaN(Date.parse(p.scheduledAt)))
        .sort((a, b) => Date.parse(a.scheduledAt as string) - Date.parse(b.scheduledAt as string));
    const groups = new Map<string, { date: Date; posts: CalendarPost[] }>();
    for (const p of dated) {
        const d = new Date(p.scheduledAt as string);
        const key = dayKey(d);
        const g = groups.get(key) ?? { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), posts: [] };
        g.posts.push(p);
        groups.set(key, g);
    }
    return [...groups.entries()].map(([key, g]) => ({ key, date: g.date, posts: g.posts }));
}

export async function fetchCalendar(api: ApiClient, from: Date, to: Date, cursor?: CalendarCursor | null) {
    const q = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    const c = cursor ? `&after_at=${encodeURIComponent(cursor.at)}&after_id=${encodeURIComponent(cursor.id)}` : '';
    return parseCalendar(await api.request(`/api/v1/social/calendar?${q}${c}`));
}

// Catalog keys for what the person should know, looked up when shown.
export function calendarErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'calendar.err.network';
    if (err.status === 429) return 'calendar.err.rate';
    if (err.status === 402) return 'calendar.err.plan';
    if (err.status === 400) return 'calendar.err.range';
    if (err.status === 404) return 'calendar.err.brand';
    if (err.status === 503) return 'calendar.err.notOpen';
    return 'common.error';
}

// ADR-0150: the month view. The first of the month to the first of the next, `offsetMonths` away from `now`'s month
// (31 days at most, under the server's 43).
export function monthBounds(now: Date, offsetMonths: number): { start: Date; end: Date } {
    const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { start, end };
}

export interface MonthCell {
    readonly key: string;
    readonly date: Date;
    readonly inMonth: boolean;
}

// Whole weeks (Monday first) that cover the month; days outside the month are marked so they can be dimmed.
export function monthGrid(monthStart: Date): MonthCell[][] {
    const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((lead + daysInMonth) / 7);
    const rows: MonthCell[][] = [];
    for (let w = 0; w < weeks; w += 1) {
        const row: MonthCell[] = [];
        for (let d = 0; d < 7; d += 1) {
            const date = new Date(first.getFullYear(), first.getMonth(), 1 - lead + w * 7 + d);
            row.push({ key: dayKey(date), date, inMonth: date.getMonth() === first.getMonth() });
        }
        rows.push(row);
    }
    return rows;
}

// How many posts fall on each local day.
export function countByDay(posts: readonly CalendarPost[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const g of dayGroups(posts)) out.set(g.key, g.posts.length);
    return out;
}
