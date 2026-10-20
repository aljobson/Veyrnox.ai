import { AuthError } from '../src/lib/auth/supabaseAuth';
import { enrollTotp, unenrollFactor, verifyFactor, type Factor } from '../src/lib/auth/accountCalls';
import { aalFromToken, enrolmentName, isTotpUri, mfaErrorKey, mfaState, needsChallenge, validCode, verifiedFactors } from '../src/lib/mfa';

const verified: Factor = { id: 'f1', status: 'verified', friendlyName: 'Phone' };
const unverified: Factor = { id: 'f2', status: 'unverified', friendlyName: 'Old attempt' };
const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

describe('reading the assurance level', () => {
    test('aal1 and aal2 come from the token; anything unreadable is unknown', () => {
        expect(aalFromToken(jwt({ aal: 'aal1' }))).toBe('aal1');
        expect(aalFromToken(jwt({ aal: 'aal2' }))).toBe('aal2');
        expect(aalFromToken(jwt({ aal: 'aal9' }))).toBeNull();
        expect(aalFromToken(jwt({}))).toBeNull();
        expect(aalFromToken('nodots')).toBeNull();
        expect(aalFromToken('a.!!!.c')).toBeNull();
        expect(aalFromToken(null)).toBeNull();
    });
});

describe('every two-factor state', () => {
    test('no factor: off, and sign-in is never stopped', () => {
        expect(mfaState({ factors: [] }, 'aal1')).toBe('none');
        expect(needsChallenge({ factors: [] }, 'aal1')).toBe(false);
        expect(needsChallenge({ factors: [] }, null)).toBe(false);
    });
    test('only an unfinished enrolment: still off, sign-in is not stopped (it would trap the person)', () => {
        expect(verifiedFactors([unverified])).toEqual([]);
        expect(mfaState({ factors: [unverified] }, 'aal1')).toBe('none');
        expect(needsChallenge({ factors: [unverified] }, 'aal1')).toBe(false);
    });
    test('a verified factor on an aal1 session: locked and challenged', () => {
        expect(mfaState({ factors: [verified] }, 'aal1')).toBe('locked');
        expect(needsChallenge({ factors: [verified] }, 'aal1')).toBe(true);
    });
    test('a verified factor and an unknown level counts as not satisfied', () => {
        expect(mfaState({ factors: [verified] }, null)).toBe('locked');
        expect(needsChallenge({ factors: [verified] }, null)).toBe(true);
    });
    test('a verified factor on an aal2 session: unlocked and not challenged again', () => {
        expect(mfaState({ factors: [verified, unverified] }, 'aal2')).toBe('unlocked');
        expect(needsChallenge({ factors: [verified] }, 'aal2')).toBe(false);
    });
});

describe('codes, names and errors', () => {
    test('a code is exactly six digits', () => {
        expect(validCode('123456')).toBe(true);
        expect(validCode('12345')).toBe(false);
        expect(validCode('1234567')).toBe(false);
        expect(validCode('12345a')).toBe(false);
        expect(validCode('')).toBe(false);
    });
    test('each enrolment attempt gets its own name', () => {
        expect(enrolmentName('ab12')).not.toBe(enrolmentName('cd34'));
    });
    test('only a totp address is handed to the authenticator app', () => {
        expect(isTotpUri('otpauth://totp/Veyrnox.ai:a@b.co?secret=ABC')).toBe(true);
        expect(isTotpUri('https://evil.example/otpauth://totp/')).toBe(false);
        expect(isTotpUri('otpauth://hotp/x')).toBe(false);
        expect(isTotpUri('')).toBe(false);
    });
    test('wording for the cases a person can act on', () => {
        expect(mfaErrorKey(new AuthError(0, 'network'))).toBe('acct.err.network');
        expect(mfaErrorKey(new AuthError(429, 'over_request_rate_limit'))).toBe('acct.mfa.err.rate');
        expect(mfaErrorKey(new AuthError(400, 'mfa_verification_failed'))).toBe('acct.mfa.err.code');
        expect(mfaErrorKey(new AuthError(422, 'mfa_challenge_expired'))).toBe('acct.mfa.err.code');
        expect(mfaErrorKey(new AuthError(500, 'x'))).toBe('acct.mfa.err.failed');
        expect(mfaErrorKey(new Error('x'))).toBe('acct.mfa.err.failed');
    });
});

describe('factor calls', () => {
    const fetchMock = jest.fn();
    const token = async () => 'tok';
    const res = (status: number, body: unknown) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) }) as unknown as Response;
    beforeEach(() => {
        fetchMock.mockReset();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });
    const call = (i: number) => ({ url: String(fetchMock.mock.calls[i][0]), init: fetchMock.mock.calls[i][1] as RequestInit });

    test('enrolling creates a totp factor and returns its secret and address', async () => {
        fetchMock.mockResolvedValue(res(200, { id: 'f9', totp: { secret: 'SECRET', uri: 'otpauth://totp/x?secret=SECRET' } }));
        expect(await enrollTotp(token, 'Veyrnox.ai ab12')).toEqual({ factorId: 'f9', secret: 'SECRET', uri: 'otpauth://totp/x?secret=SECRET' });
        expect(call(0).url).toContain('/auth/v1/factors');
        expect(JSON.parse(String(call(0).init.body))).toEqual({ factor_type: 'totp', friendly_name: 'Veyrnox.ai ab12' });
    });
    test('an enrolment answer with no id is refused rather than shown as a blank setup', async () => {
        fetchMock.mockResolvedValue(res(200, {}));
        await expect(enrollTotp(token, 'n')).rejects.toMatchObject({ status: 502 });
    });
    test('verifying challenges first, then sends the challenge id and code, and returns the new tokens', async () => {
        fetchMock.mockResolvedValueOnce(res(200, { id: 'ch1' })).mockResolvedValueOnce(res(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600 }));
        expect(await verifyFactor(token, 'f 1', '123456')).toMatchObject({ access_token: 'a' });
        expect(call(0).url).toContain('/auth/v1/factors/f%201/challenge');
        expect(call(1).url).toContain('/auth/v1/factors/f%201/verify');
        expect(JSON.parse(String(call(1).init.body))).toEqual({ challenge_id: 'ch1', code: '123456' });
    });
    test('a wrong code is an error and sends nothing further', async () => {
        fetchMock.mockResolvedValueOnce(res(200, { id: 'ch1' })).mockResolvedValueOnce(res(422, { error_code: 'mfa_verification_failed' }));
        await expect(verifyFactor(token, 'f1', '000000')).rejects.toMatchObject({ status: 422, code: 'mfa_verification_failed' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    test('a challenge with no id stops before the code is sent', async () => {
        fetchMock.mockResolvedValueOnce(res(200, {}));
        await expect(verifyFactor(token, 'f1', '123456')).rejects.toMatchObject({ status: 502 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    test('removing a factor is a DELETE on that factor; the server refuses it below aal2', async () => {
        fetchMock.mockResolvedValueOnce(res(200, {}));
        await unenrollFactor(token, 'f1');
        expect(call(0).init.method).toBe('DELETE');
        expect(call(0).url).toContain('/auth/v1/factors/f1');
        fetchMock.mockResolvedValueOnce(res(403, { error_code: 'insufficient_aal' }));
        await expect(unenrollFactor(token, 'f1')).rejects.toMatchObject({ status: 403, code: 'insufficient_aal' });
    });
});
