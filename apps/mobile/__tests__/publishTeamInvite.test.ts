import { API_BASE, ApiError, type ApiClient } from '../src/lib/api';
import { inviteErrorKey, inviteMember, isInviteLink, parseInvited, validEmail } from '../src/lib/publishTeam';

describe('team invite', () => {
    test('email check', () => {
        expect(validEmail('lee@example.test')).toBe(true);
        expect(validEmail('lee@')).toBe(false);
        expect(validEmail('a b@x.test')).toBe(false);
        expect(validEmail(`${'a'.repeat(250)}@x.test`)).toBe(false);
    });
    test('only an https invitation link on the API origin is kept', () => {
        const base = 'https://app.example.test';
        expect(isInviteLink('https://app.example.test/social/team/invite/tok', base)).toBe(true);
        expect(isInviteLink('http://app.example.test/social/team/invite/tok', base)).toBe(false);
        expect(isInviteLink('https://app.example.test/social/review/tok', base)).toBe(false);
        expect(isInviteLink('javascript:alert(1)', base)).toBe(false);
        expect(isInviteLink(5, base)).toBe(false);
    });
    test('a link on another host or a lookalike is dropped', () => {
        const base = 'https://app.example.test';
        expect(isInviteLink('https://evil.test/social/team/invite/tok', base)).toBe(false);
        expect(isInviteLink('https://app.example.test.evil.test/social/team/invite/tok', base)).toBe(false);
        expect(isInviteLink('https://app.example.test@evil.test/social/team/invite/tok', base)).toBe(false);
        expect(isInviteLink('https://evil.test@app.example.test/social/team/invite/tok', base)).toBe(false);
        expect(isInviteLink('https://user:pw@app.example.test/social/team/invite/tok', base)).toBe(false);
        expect(isInviteLink('https://app.example.test:8443/social/team/invite/tok', base)).toBe(false);
    });
    test('parses the answer and drops a bad link', () => {
        const mine = `${API_BASE}/social/team/invite/t`;
        const ok = parseInvited({ invitation: { id: 'i1', email: 'a@x.test', role: 'editor', expires_at: '2026-11-01T00:00:00Z', url: mine }, idempotent: true });
        expect(ok.invitation).toEqual({ id: 'i1', email: 'a@x.test', role: 'editor', expiresAt: '2026-11-01T00:00:00Z', url: mine });
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
