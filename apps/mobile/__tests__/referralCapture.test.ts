import { ApiError } from '../src/lib/api';
import { attachIsFinal, recallReferral, referralFromLink, rememberReferralFromLink, REFERRAL_TTL_MS, type ReferralStore } from '../src/lib/referralCapture';

const memory = (initial: string | null = null) => {
    let value = initial;
    const store: ReferralStore = { get: () => value, set: (v) => { value = v; }, remove: () => { value = null; } };
    return { store, peek: () => value };
};
const CODE = 'ABCDEFGH23';
const NOW = 1_800_000_000_000;

describe('referralFromLink', () => {
    test('reads a well-formed code from a veyrnox.ai link, in any case', () => {
        expect(referralFromLink(`https://veyrnox.ai/app/create?ref=${CODE}`)).toBe(CODE);
        expect(referralFromLink(`https://www.veyrnox.ai/app/create?ref=${CODE.toLowerCase()}`)).toBe(CODE);
    });
    test('ignores other hosts, other schemes, bad codes and links without a code', () => {
        expect(referralFromLink(`https://evil.example/app/create?ref=${CODE}`)).toBeNull();
        expect(referralFromLink(`http://veyrnox.ai/app/create?ref=${CODE}`)).toBeNull();
        expect(referralFromLink('https://veyrnox.ai/app/create?ref=ABCDEFGH10')).toBeNull();
        expect(referralFromLink('https://veyrnox.ai/app/create')).toBeNull();
        expect(referralFromLink('/app/create?ref=' + CODE)).toBeNull();
        expect(referralFromLink('not a url')).toBeNull();
    });
});

describe('remember and recall', () => {
    test('keeps the code from a link and recalls it', () => {
        const { store } = memory();
        expect(rememberReferralFromLink(`https://veyrnox.ai/app/credits?ref=${CODE}`, store, NOW)).toBe(true);
        expect(recallReferral(store, NOW + 1000)).toBe(CODE);
    });
    test('does not touch the store for a link with no code', () => {
        const { store, peek } = memory();
        expect(rememberReferralFromLink('https://veyrnox.ai/app/credits', store, NOW)).toBe(false);
        expect(peek()).toBeNull();
    });
    test('a newer code replaces an older one', () => {
        const { store } = memory();
        rememberReferralFromLink(`https://veyrnox.ai/app/credits?ref=${CODE}`, store, NOW);
        rememberReferralFromLink('https://veyrnox.ai/app/credits?ref=ZZZZZZZZ22', store, NOW + 5);
        expect(recallReferral(store, NOW + 10)).toBe('ZZZZZZZZ22');
    });
    test('an expired record is removed and not returned', () => {
        const { store, peek } = memory(JSON.stringify({ code: CODE, at: NOW }));
        expect(recallReferral(store, NOW + REFERRAL_TTL_MS)).toBe(CODE);
        expect(recallReferral(store, NOW + REFERRAL_TTL_MS + 1)).toBeNull();
        expect(peek()).toBeNull();
    });
    test('a record dated in the future is removed', () => {
        const { store, peek } = memory(JSON.stringify({ code: CODE, at: NOW + REFERRAL_TTL_MS + 10 }));
        expect(recallReferral(store, NOW)).toBeNull();
        expect(peek()).toBeNull();
    });
    test('broken or malformed records are removed', () => {
        for (const raw of ['{', 'null', '"x"', JSON.stringify({ code: 'bad', at: NOW }), JSON.stringify({ code: CODE })]) {
            const { store, peek } = memory(raw);
            expect(recallReferral(store, NOW)).toBeNull();
            expect(peek()).toBeNull();
        }
    });
});

describe('attachIsFinal', () => {
    test('the server answering about the code or account is final', () => {
        expect(attachIsFinal(new ApiError(404, 'not_found'))).toBe(true);
        expect(attachIsFinal(new ApiError(400, 'invalid_code'))).toBe(true);
        expect(attachIsFinal(new ApiError(409, 'already_attached'))).toBe(true);
        expect(attachIsFinal(new ApiError(409, 'not_new'))).toBe(true);
    });
    test('an unprovisioned account, rate limit, server or network failure is retried', () => {
        expect(attachIsFinal(new ApiError(409, 'user_not_provisioned'))).toBe(false);
        expect(attachIsFinal(new ApiError(429, 'rate_limited'))).toBe(false);
        expect(attachIsFinal(new ApiError(503, 'service_unavailable'))).toBe(false);
        expect(attachIsFinal(new ApiError(0, 'network'))).toBe(false);
        expect(attachIsFinal(new Error('x'))).toBe(false);
    });
});
