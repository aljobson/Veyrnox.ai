import { afterWelcomeHref, freeTrialDays, hardPaywallEnabled, hardPaywallState, isHardPaywallExempt } from '../src/lib/hardPaywall';

describe('hard paywall (ADR-0108 amendment 2)', () => {
    const base = { enabled: true, paidAccess: false, accessResolved: true, billingStatus: 'ready' as const };

    it('is on only for the exact string "true"', () => {
        expect(hardPaywallEnabled('true')).toBe(true);
        for (const v of [undefined, '', 'false', 'TRUE', '1']) expect(hardPaywallEnabled(v)).toBe(false);
    });
    it('never locks while the flag is off', () => {
        expect(hardPaywallState({ ...base, enabled: false })).toBe('open');
    });
    it('opens for anyone with a paid entitlement', () => {
        expect(hardPaywallState({ ...base, paidAccess: true })).toBe('open');
    });
    it('waits while the store or the server is still answering', () => {
        expect(hardPaywallState({ ...base, billingStatus: 'loading' })).toBe('checking');
        expect(hardPaywallState({ ...base, accessResolved: false })).toBe('checking');
    });
    it('locks an unsubscribed person once access is known, and when billing is unavailable', () => {
        expect(hardPaywallState(base)).toBe('locked');
        expect(hardPaywallState({ ...base, billingStatus: 'off', accessResolved: false })).toBe('locked');
    });
    it('keeps account deletion and legal pages reachable', () => {
        expect(isHardPaywallExempt('/delete-account')).toBe(true);
        expect(isHardPaywallExempt('/welcome')).toBe(true);
        expect(isHardPaywallExempt('/vibe')).toBe(true);
        expect(isHardPaywallExempt('/start')).toBe(false);
        expect(isHardPaywallExempt('/legal/terms')).toBe(true);
        expect(isHardPaywallExempt('/legal/privacy')).toBe(true);
        for (const p of ['/', '/create', '/credits', '/templates', null, undefined]) expect(isHardPaywallExempt(p)).toBe(false);
    });
    it('orders first run Welcome -> Vibe check -> paywall when on, unchanged when off', () => {
        expect(afterWelcomeHref(false, true)).toBe('/start');
        expect(afterWelcomeHref(false, false)).toBe('/start');
        expect(afterWelcomeHref(true, true)).toBe('/vibe?from=welcome');
        expect(afterWelcomeHref(true, false)).toBe('/');
    });
    it('reads a free trial from the store product only', () => {
        expect(freeTrialDays({ introPrice: { price: 0, periodUnit: 'DAY', periodNumberOfUnits: 7, cycles: 1 } })).toBe(7);
        expect(freeTrialDays({ introPrice: { price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 1, cycles: 1 } })).toBe(7);
        expect(freeTrialDays({ introPrice: { price: 1.99, periodUnit: 'DAY', periodNumberOfUnits: 7, cycles: 1 } })).toBeNull();
        expect(freeTrialDays({ introPrice: null })).toBeNull();
        expect(freeTrialDays(undefined)).toBeNull();
    });
});
