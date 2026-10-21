import { ApiError } from '../src/lib/api';
import { acceptInvite, decideReview, fetchInvite, fetchReview, inviteErrorKey, inviteOpen, parseInvite, parseReview, previewUrl, reviewErrorKey, reviewOpen, validToken } from '../src/lib/shareLinks';
import { mapAppLink } from '../src/lib/appLinks';

const TOKEN = 'invite-part-one.invite-part-two';

describe('tokens', () => {
    test('a signed token is dot-joined url-safe parts; anything else is refused', () => {
        expect(validToken(TOKEN)).toBe(true);
        for (const bad of ['', 'nodots', '../x.y', 'a.b/c', 'a b.c', `${TOKEN}${'x'.repeat(2100)}`, 'a..b', '.a.b']) expect(validToken(bad)).toBe(false);
        expect(validToken(undefined)).toBe(false);
    });
});

describe('invitation', () => {
    const fetchMock = jest.fn();
    const res = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body }) as unknown as Response;
    beforeEach(() => {
        fetchMock.mockReset();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    test('reads the invitation without signing in', async () => {
        fetchMock.mockResolvedValue(res(200, { brand_name: 'Acme', email: 'a@b.co', role: 'editor', status: 'pending', expires_at: '2027-01-01T00:00:00Z' }));
        const i = await fetchInvite(TOKEN);
        expect(i).toEqual({ brandName: 'Acme', email: 'a@b.co', role: 'editor', status: 'pending', expiresAt: '2027-01-01T00:00:00Z' });
        expect(String(fetchMock.mock.calls[0][0])).toContain(`/api/social/team/${TOKEN}`);
        expect(inviteOpen(i)).toBe(true);
        expect(inviteOpen({ ...i, status: 'accepted' })).toBe(false);
        expect(parseInvite(null).brandName).toBe('');
    });
    test('a bad token sends nothing', async () => {
        await expect(fetchInvite('../x')).rejects.toMatchObject({ status: 404 });
        await expect(acceptInvite({ request: jest.fn() } as never, 'nope')).rejects.toMatchObject({ status: 404 });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    test('accepting posts the token and returns the brand', async () => {
        const request = jest.fn(async () => ({ ok: true, brand_id: 'b1', role: 'editor' }));
        expect(await acceptInvite({ request } as never, TOKEN)).toEqual({ brandId: 'b1', role: 'editor', idempotent: false });
        const [path, init] = request.mock.calls[0] as unknown as [string, RequestInit];
        expect(path).toBe('/api/v1/social/team/accept');
        expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
    });
    test('wording: wrong email, gone, off, offline', () => {
        expect(inviteErrorKey(new ApiError(403, 'EMAIL_MISMATCH'))).toBe('share.invite.err.email');
        expect(inviteErrorKey(new ApiError(404, 'invalid_or_expired_link'))).toBe('share.invite.err.gone');
        expect(inviteErrorKey(new ApiError(404, 'teams_not_open'))).toBe('share.invite.err.off');
        expect(inviteErrorKey(new ApiError(0, 'network'))).toBe('share.err.network');
        expect(inviteErrorKey(new ApiError(502, 'internal'))).toBe('share.invite.err.failed');
    });
    test('an offline read is a network error', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));
        await expect(fetchInvite(TOKEN)).rejects.toMatchObject({ status: 0 });
    });
});

describe('review', () => {
    const fetchMock = jest.fn();
    const res = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body }) as unknown as Response;
    beforeEach(() => {
        fetchMock.mockReset();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    test('the preview path is joined to our host and nothing else is opened', () => {
        expect(previewUrl('/media/social/abc.def-1')).toMatch(/^https?:\/\/.+\/media\/social\/abc\.def-1$/);
        for (const bad of ['https://evil.example/x', '//evil.example/x', '/media/social/../x', 'javascript:alert(1)', '/other', null, 5]) expect(previewUrl(bad)).toBeNull();
    });
    test('reads the post, targets, media and decision state', () => {
        const r = parseReview({ brand_name: 'Acme', networks: ['x', 3], targets: [{ network: 'x', text: 'Hi' }, { text: 'no network' }], global_text: 'g', scheduled_at: '2027-01-01T00:00:00Z', policy: 'all', decision: 'pending', request_status: 'pending', media: { media_type: 'image', preview_url: '/media/social/t.k' } });
        expect(r).toMatchObject({ brandName: 'Acme', networks: ['x'], targets: [{ network: 'x', text: 'Hi' }], policy: 'all', mediaType: 'image' });
        expect(reviewOpen(r)).toBe(true);
        expect(reviewOpen({ ...r, decision: 'approved' })).toBe(false);
        expect(parseReview(undefined)).toMatchObject({ decision: 'pending', targets: [], previewUrl: null });
    });
    test('loads and decides with no sign-in; a blank comment is left out; an over-long one is refused', async () => {
        fetchMock.mockResolvedValueOnce(res(200, { brand_name: 'A', decision: 'pending', request_status: 'pending' }));
        expect((await fetchReview(TOKEN)).brandName).toBe('A');
        fetchMock.mockResolvedValueOnce(res(200, { decision: 'approved', request_status: 'approved' }));
        expect(await decideReview(TOKEN, 'approved', '  ')).toEqual({ decision: 'approved', requestStatus: 'approved' });
        const init = fetchMock.mock.calls[1][1] as RequestInit;
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ decision: 'approved' });
        expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
        await expect(decideReview(TOKEN, 'rejected', 'x'.repeat(2001))).rejects.toMatchObject({ code: 'invalid_decision' });
        await expect(decideReview('bad', 'rejected', '')).rejects.toMatchObject({ status: 404 });
    });
    test('wording', () => {
        expect(reviewErrorKey(new ApiError(404, 'invalid_or_expired_link'))).toBe('share.review.err.gone');
        expect(reviewErrorKey(new ApiError(0, 'network'))).toBe('share.err.network');
        expect(reviewErrorKey(new ApiError(400, 'invalid_decision'))).toBe('share.review.err.failed');
    });
});

describe('opening the links', () => {
    test('invitation and review links open their screens with the token encoded', () => {
        expect(mapAppLink(`https://veyrnox.ai/social/team/invite/${TOKEN}`)).toBe(`/team-invite?token=${TOKEN}`);
        expect(mapAppLink(`https://veyrnox.ai/social/review/${TOKEN}`)).toBe(`/review?token=${TOKEN}`);
    });
    test('odd tokens, extra segments and other hosts do not', () => {
        expect(mapAppLink('https://veyrnox.ai/social/review/nodots')).toBe('/');
        expect(mapAppLink('https://veyrnox.ai/social/review/..%2Fx.y')).toBe('/');
        expect(mapAppLink(`https://veyrnox.ai/social/review/${TOKEN}/extra`)).toBe('/');
        expect(mapAppLink(`https://veyrnox.ai/social/team/invite/${TOKEN}/x`)).toBe('/');
        expect(mapAppLink(`https://evil.example/social/review/${TOKEN}`)).toBe(`https://evil.example/social/review/${TOKEN}`);
    });
});
