import { ApiError, type ApiClient } from '../src/lib/api';
import { calendarErrorKey, dayGroups, fetchCalendar, parseCalendar, weekBounds } from '../src/lib/publishCalendar';

const row = (o: Record<string, unknown> = {}) => ({
    id: 'p1', status: 'scheduled', scheduled_at: '2026-10-21T09:30:00Z', global_text: 'Hello', created_at: '2026-10-18T10:00:00Z', updated_at: '2026-10-18T10:05:00Z',
    can_reschedule: true, can_cancel: true, can_restore: false, targets: [{ id: 't1', network: 'linkedin', publish_status: 'pending', platform_post_url: null }], ...o,
});
const apiWith = (impl: (p: string) => unknown) => {
    const request = jest.fn(async (p: string) => {
        const r = impl(p);
        if (r instanceof Error) throw r;
        return r;
    });
    return { api: { request } as unknown as ApiClient, request };
};

describe('parseCalendar', () => {
    test('keeps posts with their action flags and the version stamp, and the next cursor', () => {
        const { posts, next } = parseCalendar({ posts: [row(), row({ id: 'p2', status: 'canceled', can_cancel: false, can_restore: true })], next: { at: '2026-10-22T08:00:00Z', id: 'p9' } });
        expect(posts.map((p) => [p.id, p.canCancel, p.canRestore, p.canReschedule])).toEqual([['p1', true, false, true], ['p2', false, true, true]]);
        expect(posts[0]).toMatchObject({ updatedAt: '2026-10-18T10:05:00Z', text: 'Hello' });
        expect(posts[0]?.targets[0]?.network).toBe('linkedin');
        expect(next).toEqual({ at: '2026-10-22T08:00:00Z', id: 'p9' });
    });
    test('skips rows without an id; flags default to false; a bad cursor is dropped', () => {
        const { posts, next } = parseCalendar({ posts: [{ status: 'scheduled' }, { id: 'p3', status: 'published' }, 5], next: { at: 'x' } });
        expect(posts).toHaveLength(1);
        expect(posts[0]).toMatchObject({ id: 'p3', canCancel: false, canRestore: false, canReschedule: false });
        expect(next).toBeNull();
    });
    test.each([[null], [{}], [{ posts: 'x' }]])('%p is an empty page', (b) => {
        expect(parseCalendar(b)).toEqual({ posts: [], next: null });
    });
});

describe('weekBounds', () => {
    test('is Monday to the next Monday in local time and moves by whole weeks', () => {
        const wed = new Date(2026, 9, 21, 15, 0, 0); // Wed 21 Oct 2026, local
        const w = weekBounds(wed, 0);
        expect(w.start.getDay()).toBe(1);
        expect(w.start.getHours()).toBe(0);
        expect(w.end.getTime() - w.start.getTime()).toBeGreaterThanOrEqual(6.9 * 86400000);
        expect(w.start.getTime()).toBeLessThanOrEqual(wed.getTime());
        expect(w.end.getTime()).toBeGreaterThan(wed.getTime());
        const next = weekBounds(wed, 1);
        expect(next.start.getTime()).toBe(w.end.getTime());
        expect(weekBounds(wed, -1).end.getTime()).toBe(w.start.getTime());
    });
    test('a Sunday belongs to the week that started the Monday before', () => {
        const sun = new Date(2026, 9, 25, 12, 0, 0);
        expect(weekBounds(sun, 0).start.getDate()).toBe(19);
    });
    test('the range is always under the server limit of 43 days', () => {
        const w = weekBounds(new Date(2026, 2, 29, 12), 0); // clocks change that week in many zones
        expect(w.end.getTime() - w.start.getTime()).toBeLessThan(43 * 86400000);
    });
});

describe('dayGroups', () => {
    test('groups by local day in time order and labels nothing without a date', () => {
        const a = parseCalendar({ posts: [row({ id: 'a', scheduled_at: new Date(2026, 9, 21, 18, 0).toISOString() }), row({ id: 'b', scheduled_at: new Date(2026, 9, 21, 8, 0).toISOString() }), row({ id: 'c', scheduled_at: new Date(2026, 9, 22, 9, 0).toISOString() }), row({ id: 'd', scheduled_at: null })] }).posts;
        const g = dayGroups(a);
        expect(g.map((x) => x.posts.map((p) => p.id))).toEqual([['b', 'a'], ['c']]);
        expect(g[0]?.key).toBe('2026-10-21');
    });
});

describe('fetchCalendar', () => {
    test('asks for the range, with the page cursor when given', async () => {
        const { api, request } = apiWith(() => ({ posts: [], next: null }));
        await fetchCalendar(api, new Date('2026-10-19T00:00:00Z'), new Date('2026-10-26T00:00:00Z'), { at: '2026-10-20T00:00:00Z', id: 'p9' });
        const url = new URL(`https://x${request.mock.calls[0][0]}`);
        expect(url.pathname).toBe('/api/v1/social/calendar');
        expect(url.searchParams.get('from')).toBe('2026-10-19T00:00:00.000Z');
        expect(url.searchParams.get('to')).toBe('2026-10-26T00:00:00.000Z');
        expect(url.searchParams.get('after_at')).toBe('2026-10-20T00:00:00Z');
        expect(url.searchParams.get('after_id')).toBe('p9');
    });
    test('no cursor means no cursor parameters', async () => {
        const { api, request } = apiWith(() => ({ posts: [] }));
        await fetchCalendar(api, new Date('2026-10-19T00:00:00Z'), new Date('2026-10-26T00:00:00Z'));
        expect(request.mock.calls[0][0]).not.toContain('after_');
    });
});

describe('calendarErrorKey', () => {
    const k = (s: number, c: string) => calendarErrorKey(new ApiError(s, c, { error: c }));
    test('maps server answers to plain keys', () => {
        expect(k(402, 'publish_plan_required')).toBe('calendar.err.plan');
        expect(k(503, 'calendar_not_open')).toBe('calendar.err.notOpen');
        expect(k(400, 'invalid_range')).toBe('calendar.err.range');
        expect(k(404, 'brand_not_found')).toBe('calendar.err.brand');
        expect(k(429, 'rate_limited')).toBe('calendar.err.rate');
        expect(k(0, 'network')).toBe('calendar.err.network');
        expect(k(502, 'internal')).toBe('common.error');
        expect(calendarErrorKey(new Error('x'))).toBe('common.error');
    });
});
