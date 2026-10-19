import { ApiError, type ApiClient } from '../src/lib/api';
import { attachMessage, attachReferral, fetchReferrals, friendsLine, normalizeReferralCode, referralLink } from '../src/lib/referrals';

const apiWith = (result: unknown) => {
    const request = jest.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};

describe('referral codes', () => {
    test('accepts a code as typed: trimmed and upper-cased, ten characters from the allowed alphabet', () => {
        expect(normalizeReferralCode(' abcdefgh23 ')).toBe('ABCDEFGH23');
        expect(normalizeReferralCode('ABCDEFGH23')).toBe('ABCDEFGH23');
    });

    test('refuses codes with I, L, O, 0 or 1, the wrong length, or non-text', () => {
        expect(normalizeReferralCode('ABCDEFGH10')).toBeNull();
        expect(normalizeReferralCode('ABCDEFGHIL')).toBeNull();
        expect(normalizeReferralCode('ABCDEFGH2')).toBeNull();
        expect(normalizeReferralCode('ABCDEFGH234')).toBeNull();
        expect(normalizeReferralCode('')).toBeNull();
        expect(normalizeReferralCode(undefined)).toBeNull();
    });

    test('builds the link a friend opens', () => {
        expect(referralLink('ABCDEFGH23')).toBe('https://veyrnox.ai/?ref=ABCDEFGH23');
    });

    test('words the friend count', () => {
        expect(friendsLine(0)).toBe('No friends have joined through your link yet.');
        expect(friendsLine(1)).toBe('1 friend has joined through your link.');
        expect(friendsLine(7)).toBe('7 friends have joined through your link.');
    });
});

describe('fetchReferrals', () => {
    test('returns the code and count when the feature is on', async () => {
        const { api, request } = apiWith({ enabled: true, code: 'ABCDEFGH23', referred: 3 });
        expect(await fetchReferrals(api)).toEqual({ enabled: true, code: 'ABCDEFGH23', referred: 3 });
        expect(request).toHaveBeenCalledWith('/api/v1/referrals');
    });

    test('says off when the server says off or sends something unusable', async () => {
        expect(await fetchReferrals(apiWith({ enabled: false }).api)).toEqual({ enabled: false });
        expect(await fetchReferrals(apiWith({ enabled: true, code: 'bad' }).api)).toEqual({ enabled: false });
        expect(await fetchReferrals(apiWith({ enabled: true }).api)).toEqual({ enabled: false });
    });

    test('treats a missing or bad count as zero', async () => {
        expect(await fetchReferrals(apiWith({ enabled: true, code: 'ABCDEFGH23', referred: 'x' }).api)).toEqual({ enabled: true, code: 'ABCDEFGH23', referred: 0 });
    });
});

describe('attachReferral', () => {
    test('sends only the normalised code', async () => {
        const { api, request } = apiWith({ attached: true });
        await attachReferral(api, ' abcdefgh23 ');
        const [path, init] = request.mock.calls[0] as unknown as [string, RequestInit];
        expect(path).toBe('/api/v1/referrals/attach');
        expect(JSON.parse(init.body as string)).toEqual({ code: 'ABCDEFGH23' });
    });

    test('does not call the server for a malformed code', async () => {
        const { api, request } = apiWith({ attached: true });
        await expect(attachReferral(api, 'nope')).rejects.toMatchObject({ code: 'invalid_code' });
        expect(request).not.toHaveBeenCalled();
    });
});

describe('attachMessage', () => {
    test('explains each refusal in plain words', () => {
        expect(attachMessage(new ApiError(400, 'invalid_code'))).toMatch(/does not look right/i);
        expect(attachMessage(new ApiError(400, 'self_referral'))).toMatch(/your own/i);
        expect(attachMessage(new ApiError(409, 'not_new'))).toMatch(/new accounts/i);
        expect(attachMessage(new ApiError(409, 'already_attached'))).toMatch(/already/i);
        expect(attachMessage(new ApiError(404, 'not_found'))).toMatch(/not available/i);
        expect(attachMessage(new ApiError(0, 'network'))).toMatch(/connection/i);
        expect(attachMessage(new Error('x'))).toMatch(/try again/i);
    });
});
