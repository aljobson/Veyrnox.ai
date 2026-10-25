import { LOW_CREDIT_THRESHOLD, NEW_ACCOUNT_DAYS, paywallReason } from '../src/lib/paywallPrompt';

describe('mobile paywall parity with the website', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');

    test('keeps the website thresholds', () => {
        expect(LOW_CREDIT_THRESHOLD).toBe(10);
        expect(NEW_ACCOUNT_DAYS).toBe(7);
    });

    test('shows once to a new account even with the full signup grant', () => {
        expect(paywallReason({ credits: 10, createdAt: '2026-10-24T12:00:00Z', seenFirst: false, shownThisSession: false, now })).toBe('first');
        expect(paywallReason({ credits: 10, createdAt: '2026-10-24T12:00:00Z', seenFirst: true, shownThisSession: false, now })).toBeNull();
    });

    test('shows once per sign-in below ten credits', () => {
        expect(paywallReason({ credits: 9, createdAt: '2026-09-01T12:00:00Z', seenFirst: true, shownThisSession: false, now })).toBe('low');
        expect(paywallReason({ credits: 9, createdAt: '2026-09-01T12:00:00Z', seenFirst: true, shownThisSession: true, now })).toBeNull();
    });

    test('treats each zero-balance cycle independently', () => {
        expect(paywallReason({ credits: 0, createdAt: null, seenFirst: true, shownThisSession: true, shownDepletedBalance: false, now })).toBe('depleted');
        expect(paywallReason({ credits: 0, createdAt: null, seenFirst: true, shownThisSession: true, shownDepletedBalance: true, now })).toBeNull();
    });

    test('never opens before a numeric balance is known', () => {
        expect(paywallReason({ credits: null, createdAt: null, seenFirst: false, shownThisSession: false, now })).toBeNull();
    });
});
