import { ApiError, type ApiClient } from '../src/lib/api';
import { parseAnalytics } from '../src/lib/publish';
import { allowedRanges, barHeights, delta, percentText, previousBounds, rangeBounds, summarize, thin } from '../src/lib/publishAnalytics';
import { countByDay, monthBounds, monthGrid, type CalendarPost } from '../src/lib/publishCalendar';
import { approveBatch, discardDrafts, draftActionErrorKey, groupNetworks, parseDrafts } from '../src/lib/publishDrafts';

const apiWith = (result: unknown) => {
    const request = jest.fn(async (_p: string, _i?: RequestInit) => result);
    return { api: { request } as unknown as ApiClient, request };
};

describe('analytics ranges', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    test('the range ends today and counts the days inclusive', () => {
        expect(rangeBounds(7, now)).toEqual({ from: '2026-10-13', to: '2026-10-19' });
        expect(rangeBounds(1, now)).toEqual({ from: '2026-10-19', to: '2026-10-19' });
    });
    test('the earlier period is the same length and ends the day before', () => {
        expect(previousBounds(7, now)).toEqual({ from: '2026-10-06', to: '2026-10-12' });
        expect(previousBounds(30, now).to).toBe('2026-09-19');
    });
    test('the plan cap limits the ranges and never leaves none', () => {
        expect(allowedRanges(null)).toEqual([7, 30, 90, 365]);
        expect(allowedRanges(0)).toEqual([7, 30, 90, 365]);
        expect(allowedRanges(90)).toEqual([7, 30, 90]);
        expect(allowedRanges(3)).toEqual([7]);
    });
    test('analyticsDays is read when it is a positive whole number', () => {
        expect(parseAnalytics({ analyticsDays: 366 }).analyticsDays).toBe(366);
        expect(parseAnalytics({ analyticsDays: -1 }).analyticsDays).toBeNull();
        expect(parseAnalytics({}).analyticsDays).toBeNull();
    });
});

describe('summary, compare and chart', () => {
    const a = parseAnalytics({
        evolution: [{ date: '2026-10-01', metrics: { followers: 100 } }, { date: '2026-10-02', metrics: { reach: 5 } }, { date: '2026-10-03', metrics: { followers: 130 } }],
        posts: [{ id: 'p1', metrics: { likes: 3, comments: 1, saves: 2, shares: 1, reach: 99 } }, { id: 'p2', metrics: {} }],
    });
    test('matches the web: last followers, change over the period, interactions without reach', () => {
        const s = summarize(a);
        expect(s.followers).toBe(130);
        expect(s.followersChange).toBe(30);
        expect(s.posts).toBe(2);
        expect(s.interactions).toBe(7);
        expect(s.series).toHaveLength(2);
    });
    test('one day of followers has no change', () => {
        expect(summarize(parseAnalytics({ evolution: [{ date: '2026-10-01', metrics: { followers: 5 } }] })).followersChange).toBeNull();
    });
    test('delta handles zero and missing earlier numbers', () => {
        expect(delta(10, 5)).toEqual({ change: 5, percent: 100 });
        expect(delta(5, 10)).toEqual({ change: -5, percent: -50 });
        expect(delta(5, 0)).toEqual({ change: 5, percent: null });
        expect(delta(null, 3)).toBeNull();
        expect(percentText({ change: 5, percent: 100 })).toBe('+5 (+100.0%)');
        expect(percentText({ change: 5, percent: null })).toBe('+5');
    });
    test('bars stay between 0 and 1 and a flat series does not divide by zero', () => {
        expect(barHeights([])).toEqual([]);
        expect(barHeights([5, 5, 5])).toEqual([0.5, 0.5, 0.5]);
        const h = barHeights([1, 2, 3]);
        expect(h[0]).toBeCloseTo(0.1);
        expect(h[2]).toBeCloseTo(1);
    });
    test('thin keeps the first and the last point', () => {
        const t = thin(Array.from({ length: 365 }, (_, i) => i), 60);
        expect(t).toHaveLength(60);
        expect(t[0]).toBe(0);
        expect(t[59]).toBe(364);
        expect(thin([1, 2], 60)).toEqual([1, 2]);
    });
});

describe('calendar month', () => {
    test('a month runs from the first to the first of the next', () => {
        const { start, end } = monthBounds(new Date(2026, 9, 19), 0);
        expect([start.getMonth(), start.getDate(), end.getMonth(), end.getDate()]).toEqual([9, 1, 10, 1]);
        expect(monthBounds(new Date(2026, 11, 5), 1).start.getFullYear()).toBe(2027);
        expect(monthBounds(new Date(2026, 0, 5), -1).start.getMonth()).toBe(11);
    });
    test('the grid is whole Monday-first weeks that cover the month', () => {
        const grid = monthGrid(new Date(2026, 9, 1)); // 1 Oct 2026 is a Thursday
        expect(grid.every((w) => w.length === 7)).toBe(true);
        expect(grid[0][0].date.getDay()).toBe(1);
        expect(grid[0][3].date.getDate()).toBe(1);
        expect(grid[0][2].inMonth).toBe(false);
        expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(31);
        expect(grid).toHaveLength(5);
    });
    test('a month that starts on Monday and has 28 days is four weeks', () => {
        expect(monthGrid(new Date(2027, 1, 1))).toHaveLength(4); // February 2027
    });
    test('posts are counted by local day', () => {
        const post = (id: string, at: string | null): CalendarPost => ({ id, status: 'scheduled', scheduledAt: at, text: '', createdAt: null, updatedAt: null, targets: [], canReschedule: false, canCancel: false, canRestore: false });
        const noon = new Date(2026, 9, 5, 12).toISOString();
        const c = countByDay([post('1', noon), post('2', noon), post('3', null)]);
        expect(c.get('2026-10-05')).toBe(2);
        expect(c.size).toBe(1);
    });
});

describe('drafts approve and discard', () => {
    test('approvalEnabled is false only when the server says so', () => {
        expect(parseDrafts({ drafts: [], approvalEnabled: false }).approvalEnabled).toBe(false);
        expect(parseDrafts({ drafts: [] }).approvalEnabled).toBe(true);
    });
    test('networks are named once each', () => {
        const d = (networks: string[]) => ({ id: 'x', batchId: 'b', text: '', scheduledAt: null, createdAt: null, networks, mediaTypes: [] });
        expect(groupNetworks([d(['instagram', 'linkedin']), d(['linkedin'])])).toEqual(['instagram', 'linkedin']);
    });
    test('approve posts the action and batch and reads the counts', async () => {
        const { api, request } = apiWith({ approved: 2, failed: 1 });
        expect(await approveBatch(api, 'b1')).toEqual({ approved: 2, failed: 1 });
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ action: 'approve', batchId: 'b1' });
    });
    test('discard names one draft only when asked', async () => {
        const one = apiWith({ discarded: 1 });
        expect(await discardDrafts(one.api, 'b1', 'p1')).toBe(1);
        expect(JSON.parse(String(one.request.mock.calls[0][1]?.body))).toEqual({ action: 'discard', batchId: 'b1', postId: 'p1' });
        const all = apiWith({ discarded: 3 });
        await discardDrafts(all.api, 'b1');
        expect(JSON.parse(String(all.request.mock.calls[0][1]?.body))).toEqual({ action: 'discard', batchId: 'b1' });
    });
    test('errors map to plain keys', () => {
        expect(draftActionErrorKey(new ApiError(402, 'plan_required'))).toBe('drafts.err.plan');
        expect(draftActionErrorKey(new ApiError(403, 'forbidden'))).toBe('drafts.err.role');
        expect(draftActionErrorKey(new ApiError(503, 'draft_approval_not_available'))).toBe('drafts.err.notAvailable');
        expect(draftActionErrorKey(new ApiError(0, 'network'))).toBe('drafts.err.network');
    });
});
