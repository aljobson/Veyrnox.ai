import { ApiError } from '../src/lib/api';
import { blockerText, confirmDeletion, prepareDeletion } from '../src/lib/accountDeletion';

const api = (impl: jest.Mock) => ({ request: impl });
const fail = (status: number, code: string, body: Record<string, unknown> = {}) => jest.fn().mockRejectedValue(new ApiError(status, code, body));

describe('prepareDeletion', () => {
    test('an eligible account gets a token and its forfeit', async () => {
        const request = jest.fn().mockResolvedValue({ eligible: true, blockers: [], forfeit: { credits: 120, free_credits: 20 }, confirmation_token: 'a'.repeat(64) });
        expect(await prepareDeletion(api(request))).toEqual({ kind: 'ready', forfeit: { credits: 120, freeCredits: 20 }, token: 'a'.repeat(64) });
        expect(request).toHaveBeenCalledWith('/api/v1/account/deletion', { method: 'POST' });
    });
    test('a blocked account gets the codes and no token', async () => {
        const request = jest.fn().mockResolvedValue({ eligible: false, blockers: ['projects_present', 7], forfeit: { credits: 5, free_credits: 0 } });
        expect(await prepareDeletion(api(request))).toEqual({ kind: 'blocked', forfeit: { credits: 5, freeCredits: 0 }, blockers: ['projects_present'] });
    });
    test('eligible without a token is treated as blocked, never as ready', async () => {
        const request = jest.fn().mockResolvedValue({ eligible: true, forfeit: {} });
        expect((await prepareDeletion(api(request))).kind).toBe('blocked');
    });
    test('404 means not available yet', async () => {
        expect(await prepareDeletion(api(fail(404, 'not_found')))).toEqual({ kind: 'unavailable' });
    });
    test('429 carries the wait', async () => {
        expect(await prepareDeletion(api(fail(429, 'rate_limited', { retry_after_seconds: 900 })))).toEqual({ kind: 'rate_limited', retryAfterSeconds: 900 });
    });
    test('anything else is a plain failure', async () => {
        expect(await prepareDeletion(api(fail(502, 'deletion_unavailable')))).toEqual({ kind: 'failed' });
        expect(await prepareDeletion(api(fail(0, 'network')))).toEqual({ kind: 'failed' });
    });
});

describe('confirmDeletion', () => {
    test('sends the token as a JSON body to DELETE /api/v1/account', async () => {
        const request = jest.fn().mockResolvedValue({ deleted: true, replayed: false });
        expect(await confirmDeletion(api(request), 'tok')).toEqual({ kind: 'deleted' });
        const [path, init] = request.mock.calls[0];
        expect(path).toBe('/api/v1/account');
        expect(init.method).toBe('DELETE');
        expect(JSON.parse(init.body)).toEqual({ confirmation_token: 'tok' });
    });
    test('maps the server errors the screen must tell apart', async () => {
        expect(await confirmDeletion(api(fail(409, 'deletion_blocked', { blockers: ['account_frozen'] })), 't')).toEqual({ kind: 'blocked', blockers: ['account_frozen'] });
        expect(await confirmDeletion(api(fail(400, 'confirmation_expired')), 't')).toEqual({ kind: 'expired' });
        expect(await confirmDeletion(api(fail(400, 'confirmation_invalid')), 't')).toEqual({ kind: 'expired' });
        expect(await confirmDeletion(api(fail(502, 'deletion_incomplete')), 't')).toEqual({ kind: 'retry' });
        expect(await confirmDeletion(api(fail(404, 'not_found')), 't')).toEqual({ kind: 'unavailable' });
        expect(await confirmDeletion(api(fail(502, 'deletion_unavailable')), 't')).toEqual({ kind: 'failed' });
    });
});

describe('blockerText', () => {
    test('has copy for every code the server can send and a safe fallback', () => {
        for (const code of ['account_frozen', 'account_on_hold', 'active_subscription', 'generation_in_progress', 'top_up_in_progress', 'cinema_content_present', 'projects_present', 'publish_team_present']) {
            expect(blockerText(code)).not.toMatch(/stops deletion\. Contact support\.$/);
        }
        expect(blockerText('something_new')).toMatch(/Contact support/);
    });
});
