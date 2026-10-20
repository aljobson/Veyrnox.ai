import { accountErrorKey, normaliseGrants, safeWebsite, signInMethodKey, validClientId, validNonce, validPassword } from '../src/lib/accountSecurity';
import { AuthError } from '../src/lib/auth/supabaseAuth';
import { authedCall, changePassword, fetchProfile, requestPasswordCode, revokeGrant, revokeSessions } from '../src/lib/auth/accountCalls';

const ID = '123e4567-e89b-42d3-a456-426614174000';

function reply(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? '' : JSON.stringify(body)) } as unknown as Response;
}

describe('account entry rules', () => {
    test('password length is 8 to 72', () => {
        expect(validPassword('1234567')).toBe(false);
        expect(validPassword('12345678')).toBe(true);
        expect(validPassword('x'.repeat(72))).toBe(true);
        expect(validPassword('x'.repeat(73))).toBe(false);
    });
    test('the emailed code is 6 to 10 digits', () => {
        expect(validNonce('12345')).toBe(false);
        expect(validNonce('123456')).toBe(true);
        expect(validNonce('1234567890')).toBe(true);
        expect(validNonce('12345678901')).toBe(false);
        expect(validNonce('12345a')).toBe(false);
    });
    test('a client id is a uuid', () => {
        expect(validClientId(ID)).toBe(true);
        expect(validClientId('nope')).toBe(false);
    });
});

describe('connected assistants', () => {
    test('reads a bare list and { grants } and the client object or flat fields', () => {
        const a = normaliseGrants([{ client: { id: ID, name: 'Desk', uri: 'https://example.com/a' }, scopes: ['read', 4], granted_at: '2026-01-02T00:00:00Z' }]);
        expect(a).toEqual([{ clientId: ID, name: 'Desk', website: 'https://example.com/a', scopes: ['read'], grantedAt: '2026-01-02T00:00:00Z' }]);
        const b = normaliseGrants({ grants: [{ client_id: ID, client_name: 'Flat', created_at: 'x' }] });
        expect(b[0]).toMatchObject({ clientId: ID, name: 'Flat', website: null, scopes: [], grantedAt: 'x' });
    });
    test('drops rows that cannot be revoked and survives junk', () => {
        expect(normaliseGrants([{ client: { name: 'No id' } }, { client_id: 'bad' }, null, 5])).toEqual([]);
        expect(normaliseGrants(null)).toEqual([]);
        expect(normaliseGrants({ grants: 'x' })).toEqual([]);
    });
    test('only https websites are kept', () => {
        expect(safeWebsite('http://example.com')).toBeNull();
        expect(safeWebsite('javascript:alert(1)')).toBeNull();
        expect(safeWebsite('not a url')).toBeNull();
        expect(safeWebsite('https://example.com')).toBe('https://example.com/');
    });
});

describe('error and method wording', () => {
    test('maps the cases a person can act on', () => {
        expect(accountErrorKey(new AuthError(0, 'network'))).toBe('acct.err.network');
        expect(accountErrorKey(new AuthError(403, 'insufficient_aal'))).toBe('acct.err.aal');
        expect(accountErrorKey(new AuthError(429, 'x'))).toBe('acct.err.rate');
        expect(accountErrorKey(new AuthError(400, 'reauthentication_not_valid'))).toBe('acct.err.code');
        expect(accountErrorKey(new Error('x'))).toBe('acct.err.failed');
    });
    test('names the sign-in method', () => {
        expect(signInMethodKey('email')).toBe('acct.method.email');
        expect(signInMethodKey('apple')).toBe('acct.method.apple');
        expect(signInMethodKey('google')).toBe('acct.method.google');
        expect(signInMethodKey(null)).toBe('acct.method.other');
    });
});

describe('Supabase account calls', () => {
    const fetchMock = jest.fn();
    const token = jest.fn(async () => 'tok');
    beforeEach(() => {
        fetchMock.mockReset();
        token.mockClear();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    const call = (i = 0) => ({ url: String(fetchMock.mock.calls[i][0]), init: fetchMock.mock.calls[i][1] as RequestInit });

    test('sends the bearer token and the public key, never the token in the URL', async () => {
        fetchMock.mockResolvedValue(reply(200, {}));
        await requestPasswordCode(token);
        const { url, init } = call();
        expect(url).toContain('/auth/v1/reauthenticate');
        expect(url).not.toContain('tok');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
        expect((init.headers as Record<string, string>).apikey).toBeTruthy();
    });
    test('changes the password with the code', async () => {
        fetchMock.mockResolvedValue(reply(200, {}));
        await changePassword(token, 'new-password', '123456');
        const { url, init } = call();
        expect(url).toContain('/auth/v1/user');
        expect(init.method).toBe('PUT');
        expect(JSON.parse(String(init.body))).toEqual({ password: 'new-password', nonce: '123456' });
    });
    test('signs out with the scope asked for', async () => {
        fetchMock.mockResolvedValue(reply(204, undefined));
        await revokeSessions(token, 'others');
        await revokeSessions(token, 'global');
        expect(call(0).url).toContain('/auth/v1/logout?scope=others');
        expect(call(1).url).toContain('/auth/v1/logout?scope=global');
    });
    test('revokes a grant by encoded client id', async () => {
        fetchMock.mockResolvedValue(reply(204, undefined));
        await revokeGrant(token, ID);
        expect(call().url).toContain(`/auth/v1/user/oauth/grants?client_id=${ID}`);
        expect(call().init.method).toBe('DELETE');
    });
    test('reads the profile and keeps only TOTP factors', async () => {
        fetchMock.mockResolvedValue(reply(200, { email: 'a@b.co', app_metadata: { provider: 'google' }, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Phone' }, { id: 'f2', factor_type: 'phone' }] }));
        expect(await fetchProfile(token)).toEqual({ email: 'a@b.co', provider: 'google', factors: [{ id: 'f1', status: 'verified', friendlyName: 'Phone' }] });
    });
    test('refreshes once after a 401 and retries with the new token', async () => {
        const getToken = jest.fn(async (force?: boolean) => (force ? 'fresh' : 'old'));
        fetchMock.mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(200, { ok: 1 }));
        expect(await authedCall(getToken, '/x')).toEqual({ ok: 1 });
        expect((call(1).init.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
    });
    test('a rejection becomes an AuthError with the server code; no token is a 401; offline is status 0', async () => {
        fetchMock.mockResolvedValue(reply(403, { error_code: 'insufficient_aal' }));
        await expect(changePassword(token, 'new-password', '123456')).rejects.toMatchObject({ status: 403, code: 'insufficient_aal' });
        await expect(requestPasswordCode(async () => null)).rejects.toMatchObject({ status: 401 });
        fetchMock.mockRejectedValue(new Error('offline'));
        await expect(requestPasswordCode(token)).rejects.toMatchObject({ status: 0, code: 'network' });
    });
});
