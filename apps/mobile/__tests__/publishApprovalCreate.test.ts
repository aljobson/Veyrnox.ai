import { API_BASE, ApiError, type ApiClient } from '../src/lib/api';
import { approvalBody, approvalCreateErrorKey, createApproval, isReviewLink, parseCreated, parseReviewers, signatureOf, validateApproval, type ApprovalDraft } from '../src/lib/publishApprovalCreate';

const NOW = new Date('2026-10-20T12:00:00Z');
const draft = (o: Partial<ApprovalDraft> = {}): ApprovalDraft => ({ jobId: 'job-1', mediaType: 'image', accountIds: ['a1'], text: ' Hi ', scheduledAt: new Date('2026-10-21T09:00:00Z'), reviewers: ['lee@x.test'], policy: 'any', ...o });

describe('approval create', () => {
    test('reviewer text is split, lowercased, de-duplicated; bad entries reported', () => {
        expect(parseReviewers('Lee@X.test, sam@x.test; lee@x.test\nnope')).toEqual({ emails: ['lee@x.test', 'sam@x.test'], rejected: ['nope'] });
        expect(parseReviewers('')).toEqual({ emails: [], rejected: [] });
    });
    test('validation', () => {
        expect(validateApproval(draft(), NOW)).toBeNull();
        expect(validateApproval(draft({ jobId: '' }), NOW)).toBe('approvals.err.creation');
        expect(validateApproval(draft({ accountIds: [] }), NOW)).toBe('approvals.err.accounts');
        expect(validateApproval(draft({ reviewers: [] }), NOW)).toBe('approvals.err.reviewers');
        expect(validateApproval(draft({ reviewers: Array.from({ length: 11 }, (_, i) => `r${i}@x.test`) }), NOW)).toBe('approvals.err.reviewers');
        expect(validateApproval(draft({ scheduledAt: new Date(NOW.getTime() + 30_000) }), NOW)).toBe('approvals.err.time');
    });
    test('the body carries reviewers, policy and the schedule', () => {
        const b = approvalBody(draft(), 'aaaabbbb');
        expect(b).toMatchObject({ scheduledAt: '2026-10-21T09:00:00.000Z', globalText: 'Hi', idempotencyKey: 'aaaabbbb', accountIds: ['a1'], reviewers: ['lee@x.test'], policy: 'any', media: [{ mediaType: 'image', jobId: 'job-1' }] });
    });
    test('the key signature changes with reviewers, policy and time but not order', () => {
        const base = signatureOf(draft());
        expect(signatureOf(draft({ policy: 'all' }))).not.toBe(base);
        expect(signatureOf(draft({ reviewers: ['a@x.test', 'b@x.test'] }))).toBe(signatureOf(draft({ reviewers: ['b@x.test', 'a@x.test'] })));
        expect(signatureOf(draft({ scheduledAt: new Date('2026-10-22T09:00:00Z') }))).not.toBe(base);
    });
    test('only an https review link on the API origin is kept', () => {
        const base = 'https://app.example.test';
        expect(isReviewLink('https://app.example.test/social/review/tok', base)).toBe(true);
        expect(isReviewLink('http://app.example.test/social/review/tok', base)).toBe(false);
        expect(isReviewLink('https://app.example.test/other/tok', base)).toBe(false);
        expect(isReviewLink('javascript:alert(1)', base)).toBe(false);
    });
    test('a link on another host or a lookalike is dropped', () => {
        const base = 'https://app.example.test';
        expect(isReviewLink('https://evil.test/social/review/tok', base)).toBe(false);
        expect(isReviewLink('https://app.example.test.evil.test/social/review/tok', base)).toBe(false);
        expect(isReviewLink('https://app.example.test@evil.test/social/review/tok', base)).toBe(false);
        expect(isReviewLink('https://evil.test@app.example.test/social/review/tok', base)).toBe(false);
        expect(isReviewLink('https://user:pw@app.example.test/social/review/tok', base)).toBe(false);
        expect(isReviewLink('https://app.example.test:8443/social/review/tok', base)).toBe(false);
    });
    test('parseCreated keeps only links on the API origin', () => {
        const mine = `${API_BASE}/social/review/t`;
        const c = parseCreated({ request_id: 'r1', idempotent: true, review_links: [{ email: 'a@x.test', url: mine }, { email: 'b@x.test', url: 'https://evil.test/social/review/t' }, 'x'] });
        expect(c).toEqual({ requestId: 'r1', idempotent: true, links: [{ email: 'a@x.test', url: mine }] });
        expect(parseCreated(null).links).toEqual([]);
    });
    test('create posts to approvals and returns links', async () => {
        const request = jest.fn(async (_p: string, _i?: RequestInit) => ({ request_id: 'r1', review_links: [{ email: 'lee@x.test', url: `${API_BASE}/social/review/t` }] }));
        const c = await createApproval({ request } as unknown as ApiClient, draft(), 'aaaabbbb');
        expect(request.mock.calls[0][0]).toBe('/api/v1/social/approvals');
        expect(request.mock.calls[0][1]?.method).toBe('POST');
        expect(c.links).toHaveLength(1);
    });
    test('error keys', () => {
        expect(approvalCreateErrorKey(new ApiError(402, 'plan'))).toBe('approvals.err.plan');
        expect(approvalCreateErrorKey(new ApiError(400, 'INVALID_REVIEWERS'))).toBe('approvals.err.reviewers');
        expect(approvalCreateErrorKey(new ApiError(404, 'ACCOUNT_NOT_FOUND'))).toBe('approvals.err.accountGone');
        expect(approvalCreateErrorKey(new ApiError(0, 'network'))).toBe('approvals.err.createNetwork');
    });
});
