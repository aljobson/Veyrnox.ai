import { API_BASE, ApiError, type ApiClient } from '../src/lib/api';
import { approvalBody, approvalConfirmExtra, approvalCreateErrorKey, variantsUnavailable, createApproval, isReviewLink, parseCreated, parseReviewers, signatureOf, validateApproval, type ApprovalDraft } from '../src/lib/publishApprovalCreate';

import { cleanNetworkText } from '../src/lib/publishCompose';

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

test('upload source validation, body and signatures preserve the job signature', () => {
    const d = draft({ jobId: '', uploadId: 'u' });
    expect(validateApproval(d, NOW)).toBeNull();
    expect(validateApproval(draft({ uploadId: 'u' }), NOW)).toBe('approvals.err.creation');
    expect(approvalBody(d, 'key').media).toEqual([{ mediaType: 'image', uploadId: 'u' }]);
    expect(signatureOf(draft())).toBe('["approval","job-1","image",["a1"],"Hi","2026-10-21T09:00:00.000Z",["lee@x.test"],"any"]');
    expect(signatureOf(d)).toBe('["approval","upload:u","image",["a1"],"Hi","2026-10-21T09:00:00.000Z",["lee@x.test"],"any"]');
});
test.each([[404, 'MEDIA_NOT_FOUND'], [400, 'invalid_media']] as const)('upload-only error mapping %s %s', (status, code) => {
    const err = new ApiError(status, code);
    expect(approvalCreateErrorKey(err, true)).toBe('publishUploads.unavailable');
    expect(approvalCreateErrorKey(err)).toBe(approvalCreateErrorKey(err, false));
    expect(approvalCreateErrorKey(err)).not.toBe('publishUploads.unavailable');
});

describe('approval variants and visibility', () => {
    test('plain body stays exactly seven keys; empty variants are omitted', () => {
        const plain = { scheduledAt: '2026-10-21T09:00:00.000Z', globalText: 'Hi', idempotencyKey: 'key', accountIds: ['a1'], media: [{ mediaType: 'image', jobId: 'job-1' }], reviewers: ['lee@x.test'], policy: 'any' };
        expect(approvalBody(draft(), 'key')).toEqual(plain);
        expect(approvalBody(draft({ networkText: {} }), 'key')).toEqual(plain);
        const networkText = cleanNetworkText({ twitter: 'X text', youtube: ' ', instagram: 'not chosen' }, ['twitter', 'youtube']);
        expect(approvalBody(draft({ networkText, youtubeVisibility: 'private' }), 'key')).toEqual({ ...plain, networkText: { twitter: 'X text' }, youtubeVisibility: 'private' });
    });
    test('plain signature stays literal; variants and visibility change it, entry order does not', () => {
        const plain = '["approval","job-1","image",["a1"],"Hi","2026-10-21T09:00:00.000Z",["lee@x.test"],"any"]';
        expect(signatureOf(draft())).toBe(plain);
        expect(signatureOf(draft({ networkText: {} }))).toBe(plain);
        expect(signatureOf(draft({ networkText: { twitter: 'one' } }))).not.toBe(plain);
        expect(signatureOf(draft({ networkText: { twitter: 'one' } }))).not.toBe(signatureOf(draft({ networkText: { twitter: 'two' } })));
        expect(signatureOf(draft({ youtubeVisibility: 'private' }))).not.toBe(plain);
        expect(signatureOf(draft({ youtubeVisibility: 'private' }))).not.toBe(signatureOf(draft({ youtubeVisibility: 'public' })));
        expect(signatureOf(draft({ networkText: { twitter: 'x', youtube: 'y' } }))).toBe(signatureOf(draft({ networkText: { youtube: 'y', twitter: 'x' } })));
    });
    test('variant length counts code points and follows text validation, before reviewers', () => {
        expect(validateApproval(draft({ networkText: { twitter: '😀'.repeat(281) }, reviewers: [] }), NOW)).toBe('publishLinks.err.variantTooLong');
        expect(validateApproval(draft({ networkText: { twitter: '😀'.repeat(280) } }), NOW)).toBeNull();
        expect(validateApproval(draft({ text: 'x'.repeat(4001), networkText: { twitter: 'x'.repeat(281) } }), NOW)).toBe('approvals.err.text');
    });
    test.each([
        new ApiError(402, 'other', { feature: 'platform_variants' }), new ApiError(402, 'publish_plan_required'),
        new ApiError(404, 'variants_not_open'), new ApiError(503, 'variants_not_configured'),
    ])('variant refusal is detected before generic mapping %#', (error) => {
        expect(variantsUnavailable(error)).toBe(true);
        expect(approvalCreateErrorKey(error)).toBe('publishLinks.err.variantsOff');
    });
    test('unrelated errors do not disable variants; server length error has its own message', () => {
        for (const error of [new ApiError(402, 'plan'), new ApiError(404, 'ACCOUNT_NOT_FOUND'), new ApiError(503, 'other'), new Error('failed')]) expect(variantsUnavailable(error)).toBe(false);
        expect(approvalCreateErrorKey(new ApiError(402, 'plan'))).toBe('approvals.err.plan');
        expect(approvalCreateErrorKey(new ApiError(400, 'caption_too_long'))).toBe('publishLinks.err.variantTooLong');
    });
    test('confirmation names networks and visibility, truncating only beyond 60 code points', () => {
        expect(approvalConfirmExtra()).toEqual([]);
        expect(approvalConfirmExtra({ twitter: '😀'.repeat(61), linkedin: 'a'.repeat(60) }, 'private')).toEqual([
            `X: ${'😀'.repeat(60)}…`, `LinkedIn: ${'a'.repeat(60)}`, 'YouTube visibility: Private',
        ]);
        expect(approvalConfirmExtra({}, 'unlisted')).toEqual(['YouTube visibility: Unlisted']);
        expect(approvalConfirmExtra({}, 'public')).toEqual(['YouTube visibility: Public']);
    });
});
