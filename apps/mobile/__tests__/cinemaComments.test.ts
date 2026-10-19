import { ApiError, type ApiClient } from '../src/lib/api';
import {
    DETAILS_MAX,
    DETAILS_MIN,
    REPORT_CATEGORIES,
    bodyOk,
    commentsErrorKey,
    detailsOk,
    fetchComments,
    parseComments,
    reportComment,
    submitComment,
} from '../src/lib/cinemaComments';

const CID = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const apiWith = (impl: (path: string, init?: RequestInit) => unknown) => {
    const request = jest.fn(async (p: string, i?: RequestInit) => {
        const r = impl(p, i);
        if (r instanceof Error) throw r;
        return r;
    });
    return { api: { request } as unknown as ApiClient, request };
};
const sent = (r: jest.Mock) => ({ init: r.mock.calls[0][1] as RequestInit, body: JSON.parse(String((r.mock.calls[0][1] as RequestInit).body)) });

describe('parseComments', () => {
    test('keeps comments, the person\'s own comments with status, and the cursor', () => {
        const out = parseComments({
            comments: [{ id: C1, body: 'Loved it', created_at: '2026-10-18T10:00:00Z', username: 'sam_1', display_name: 'Sam', own: false }],
            own_comments: [{ id: KEY, body: 'Mine', status: 'pending', created_at: '2026-10-18T11:00:00Z' }],
            next_cursor: C1,
        });
        expect(out.comments).toEqual([{ id: C1, body: 'Loved it', createdAt: '2026-10-18T10:00:00Z', username: 'sam_1', displayName: 'Sam', own: false }]);
        expect(out.own).toEqual([{ id: KEY, body: 'Mine', status: 'pending', createdAt: '2026-10-18T11:00:00Z' }]);
        expect(out.next).toBe(C1);
    });
    test('skips rows without an id or text; a bad cursor is dropped; long text is bounded', () => {
        const out = parseComments({
            comments: [{ body: 'no id', username: 'a', display_name: 'A' }, { id: C1, body: '', username: 'abc', display_name: 'A' }, { id: C1, body: 'x'.repeat(5000), username: 'abc', display_name: 'A', created_at: '2026-10-18T10:00:00Z' }, 9],
            next_cursor: 'nope',
        });
        expect(out.comments).toHaveLength(1);
        expect(out.comments[0]?.body.length).toBeLessThanOrEqual(2000);
        expect(out.next).toBeNull();
    });
    test('a username that is not valid is kept as null (so Block is not offered)', () => {
        const [c] = parseComments({ comments: [{ id: C1, body: 'hi', username: 'Bad Name!', display_name: 'Z', created_at: '2026-10-18T10:00:00Z' }] }).comments;
        expect(c?.username).toBeNull();
        expect(c?.displayName).toBe('Z');
    });
    test.each([[null], [{}], [{ comments: 'x' }]])('%p is empty', (b) => {
        expect(parseComments(b)).toEqual({ comments: [], own: [], next: null });
    });
});

describe('validation (the server rules)', () => {
    test('a comment is 1 to 2000 characters after trimming, counted as characters not bytes', () => {
        expect(bodyOk('  hi  ')).toBe(true);
        expect(bodyOk('   ')).toBe(false);
        expect(bodyOk('a'.repeat(2000))).toBe(true);
        expect(bodyOk('a'.repeat(2001))).toBe(false);
        expect(bodyOk('😀'.repeat(2000))).toBe(true);
    });
    test('report details are 3 to 500 characters after trimming', () => {
        expect([DETAILS_MIN, DETAILS_MAX]).toEqual([3, 500]);
        expect(detailsOk('ab')).toBe(false);
        expect(detailsOk(' abc ')).toBe(true);
        expect(detailsOk('a'.repeat(500))).toBe(true);
        expect(detailsOk('a'.repeat(501))).toBe(false);
    });
    test('the report categories are the server\'s five, in a fixed order', () => {
        expect(REPORT_CATEGORIES.map((c) => c.key)).toEqual(['spam', 'abuse', 'privacy', 'rights', 'other']);
    });
});

describe('the calls', () => {
    test('fetchComments asks for the title, with the cursor when given', async () => {
        const { api, request } = apiWith(() => ({ comments: [] }));
        await fetchComments(api, CID);
        await fetchComments(api, CID, C1);
        expect(request.mock.calls[0][0]).toBe(`/api/v1/cinema/comments?content_id=${CID}`);
        expect(request.mock.calls[1][0]).toBe(`/api/v1/cinema/comments?content_id=${CID}&before_id=${C1}`);
    });
    test('fetchComments refuses ids that are not UUIDs without calling the server', async () => {
        const { api, request } = apiWith(() => ({}));
        await expect(fetchComments(api, '../x')).rejects.toMatchObject({ status: 400 });
        expect(request).not.toHaveBeenCalled();
    });
    test('submitComment sends action submit with the trimmed body and an idempotency key header', async () => {
        const { api, request } = apiWith(() => ({ id: C1, status: 'pending', idempotent: false }));
        expect(await submitComment(api, CID, '  Great film  ', KEY)).toEqual({ id: C1, status: 'pending', replayed: false });
        const { init, body } = sent(request);
        expect(request.mock.calls[0][0]).toBe('/api/v1/cinema/comments');
        expect(init.method).toBe('POST');
        expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(KEY);
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect(body).toEqual({ action: 'submit', content_id: CID, body: 'Great film' });
    });
    test('submitComment refuses an empty comment or a bad key before sending', async () => {
        const { api, request } = apiWith(() => ({}));
        await expect(submitComment(api, CID, '   ', KEY)).rejects.toMatchObject({ code: 'invalid_comment' });
        await expect(submitComment(api, CID, 'ok', 'not-a-uuid')).rejects.toMatchObject({ code: 'invalid_idempotency_key' });
        expect(request).not.toHaveBeenCalled();
    });
    test('reportComment sends action report with the category and trimmed details', async () => {
        const { api, request } = apiWith(() => ({ id: 'r1', status: 'open', idempotent: false }));
        expect(await reportComment(api, C1, 'abuse', '  Targets a person  ', KEY)).toEqual({ replayed: false });
        const { init, body } = sent(request);
        expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(KEY);
        expect(body).toEqual({ action: 'report', comment_id: C1, category: 'abuse', details: 'Targets a person' });
    });
    test('reportComment refuses a bad category or short details before sending', async () => {
        const { api, request } = apiWith(() => ({}));
        await expect(reportComment(api, C1, 'weird', 'long enough', KEY)).rejects.toMatchObject({ code: 'invalid_report' });
        await expect(reportComment(api, C1, 'spam', 'ab', KEY)).rejects.toMatchObject({ code: 'invalid_report' });
        expect(request).not.toHaveBeenCalled();
    });
    test('a replay is reported as replayed', async () => {
        const { api } = apiWith(() => ({ id: C1, status: 'pending', idempotent: true }));
        expect((await submitComment(api, CID, 'hi', KEY)).replayed).toBe(true);
    });
});

describe('commentsErrorKey', () => {
    const k = (s: number, c: string) => commentsErrorKey(new ApiError(s, c, { error: c }));
    test('maps the server answers to plain keys', () => {
        expect(k(403, 'profile_required')).toBe('comments.err.profile');
        expect(k(403, 'account_not_active')).toBe('comments.err.account');
        expect(k(403, 'self_report_forbidden')).toBe('comments.err.self');
        expect(k(404, 'comment_not_found')).toBe('comments.err.gone');
        expect(k(404, 'content_not_found')).toBe('comments.err.gone');
        expect(k(429, 'pending_limit')).toBe('comments.err.pending');
        expect(k(429, 'rate_limited')).toBe('comments.err.rate');
        expect(k(409, 'idempotency_conflict')).toBe('comments.err.conflict');
        expect(k(503, 'comments_not_open')).toBe('comments.err.notOpen');
        expect(k(503, 'temporarily_unavailable')).toBe('comments.err.later');
        expect(k(0, 'network')).toBe('comments.err.network');
        expect(k(400, 'invalid_comment')).toBe('comments.err.invalid');
        expect(commentsErrorKey(new Error('x'))).toBe('common.error');
    });
});
