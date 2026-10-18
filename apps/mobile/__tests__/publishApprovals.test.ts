import { ApiError } from '../src/lib/api';
import { approvalErrorKey, approvalStatusLabel, decisionLabel, parseApprovals } from '../src/lib/publishApprovals';

const ID = '33333333-3333-4333-8333-333333333333';

describe('parseApprovals', () => {
    test('keeps the request, its text, time and each reviewer decision', () => {
        const [r] = parseApprovals({
            brand_id: 'b',
            requests: [
                {
                    id: ID, post_id: 'p1', policy: 'any', status: 'pending', scheduled_at: '2026-10-20T09:00:00Z', global_text: 'Launch day',
                    created_at: '2026-10-18T10:00:00Z',
                    reviewers: [
                        { id: 'r1', email: 'a@example.com', decision: 'approved', comment: 'Looks good', decided_at: '2026-10-18T11:00:00Z' },
                        { id: 'r2', email: 'b@example.com', decision: 'pending', comment: null, decided_at: null },
                    ],
                },
            ],
        });
        expect(r).toMatchObject({ id: ID, postId: 'p1', status: 'pending', text: 'Launch day', scheduledAt: '2026-10-20T09:00:00Z', policy: 'any' });
        expect(r?.reviewers.map((v) => [v.email, v.decision, v.comment])).toEqual([['a@example.com', 'approved', 'Looks good'], ['b@example.com', 'pending', null]]);
    });
    test('never keeps the signed review link the server adds to each reviewer', () => {
        const [r] = parseApprovals({ requests: [{ id: ID, status: 'pending', reviewers: [{ id: 'r1', email: 'a@example.com', decision: 'pending', url: 'https://x.test/social/review/SECRETTOKEN' }] }] });
        expect(JSON.stringify(r)).not.toContain('SECRETTOKEN');
        expect(JSON.stringify(r)).not.toContain('review/');
    });
    test('skips rows without an id and bounds long text and comments', () => {
        const rows = parseApprovals({ requests: [{ status: 'pending' }, { id: ID, status: 'approved', global_text: 'x'.repeat(5000), reviewers: [{ id: 'r', email: 'a@b.co', decision: 'rejected', comment: 'y'.repeat(5000) }] }, 7] });
        expect(rows).toHaveLength(1);
        expect((rows[0]?.text ?? '').length).toBeLessThanOrEqual(600);
        expect((rows[0]?.reviewers[0]?.comment ?? '').length).toBeLessThanOrEqual(600);
    });
    test('a null reviewers list and a missing body are fine', () => {
        expect(parseApprovals({ requests: [{ id: ID, status: 'pending', reviewers: null }] })[0]?.reviewers).toEqual([]);
        expect(parseApprovals(null)).toEqual([]);
        expect(parseApprovals({})).toEqual([]);
    });
});

describe('labels', () => {
    test('status and decision words are plain', () => {
        expect(approvalStatusLabel('pending')).toBe('Waiting for review');
        expect(approvalStatusLabel('approved')).toBe('Approved');
        expect(approvalStatusLabel('rejected')).toBe('Rejected');
        expect(approvalStatusLabel('canceled')).toBe('Canceled');
        expect(decisionLabel('pending')).toBe('Not yet');
        expect(decisionLabel('commented')).toBe('Left a comment');
    });
    test('an unknown word is shown tidied, never raw underscores', () => {
        expect(approvalStatusLabel('some_new_state')).toBe('Some new state');
        expect(decisionLabel('')).toBe('Not yet');
    });
});

describe('approvalErrorKey', () => {
    const k = (status: number, code: string) => approvalErrorKey(new ApiError(status, code, { error: code }));
    test('maps the server answers to plain-English keys', () => {
        expect(k(402, 'plan_required')).toBe('approvals.err.plan');
        expect(k(403, 'brand_role_forbidden')).toBe('approvals.err.role');
        expect(k(404, 'approvals_not_open')).toBe('approvals.err.notOpen');
        expect(k(404, 'brand_not_found')).toBe('approvals.err.brand');
        expect(k(429, 'rate_limited')).toBe('approvals.err.rate');
        expect(k(0, 'network')).toBe('approvals.err.network');
        expect(k(503, 'approvals_not_configured')).toBe('approvals.err.later');
    });
    test('anything else is the common error', () => {
        expect(k(502, 'internal')).toBe('common.error');
        expect(approvalErrorKey(new Error('x'))).toBe('common.error');
    });
});
