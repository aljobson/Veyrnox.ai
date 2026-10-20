import { ApiError, type ApiClient } from '../src/lib/api';
import { inviteErrorKey, inviteMember, isInviteLink, parseInvited, validEmail } from '../src/lib/publishTeam';

describe('team invite', () => {
    test('email check', () => {
        expect(validEmail('lee@example.test')).toBe(true);
        expect(validEmail('lee@')).toBe(false);
        expect(validEmail('a b@x.test')).toBe(false);
        expect(validEmail(`${'a'.repeat(250)}@x.test`)).toBe(false);
    });
    test('only an https invitation link is kept', () => {
        expect(isInviteLink('https://h.test/social/team/invite/tok')).toBe(true);
        expect(isInviteLink('http://h.test/social/team/invite/tok')).toBe(false);
        expect(isInviteLink('https://h.test/social/review/tok')).toBe(false);
        expect(isInviteLink('javascript:alert(1)')).toBe(false);
        expect(isInviteLink(5)).toBe(false);
    });
    test('parses the answer and drops a bad link', () => {
        const ok = parseInvited({ invitation: { id: 'i1', email: 'a@x.test', role: 'editor', expires_at: '2026-11-01T00:00:00Z', url: 'https://h.test/social/team/invite/t' }, idempotent: true });
        expect(ok.invitation).toEqual({ id: 'i1', email: 'a@x.test', role: 'editor', expiresAt: '2026-11-01T00:00:00Z', url: 'https://h.test/social/team/invite/t' });
        expect(ok.idempotent).toBe(true);
        expect(parseInvited({ invitation: { id: 'i1', email: 'a@x.test', url: 'https://evil.test/x' } }).invitation?.url).toBeNull();
        expect(parseInvited(null).invitation).toBeNull();
    });
    test('the request is a POST with a lowercase email and the brand', async () => {
        const request = jest.fn(async (_p: string, _i?: RequestInit) => ({ invitation: { id: 'i1', email: 'a@x.test' } }));
        await inviteMember({ request } as unknown as ApiClient, 'b1', ' A@X.test ', 'viewer');
        expect(request.mock.calls[0][1]?.method).toBe('POST');
        expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ brandId: 'b1', email: 'a@x.test', role: 'viewer' });
    });
    test('error keys', () => {
        expect(inviteErrorKey(new ApiError(400, 'INVALID_ROLE'))).toBe('team.err.inviteInvalid');
        expect(inviteErrorKey(new ApiError(429, 'RATE_LIMITED'))).toBe('team.err.rate');
        expect(inviteErrorKey(new ApiError(403, 'FORBIDDEN'))).toBe('team.err.cannot');
    });
});
