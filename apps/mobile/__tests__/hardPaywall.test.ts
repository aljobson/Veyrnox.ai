import { HARD_PAYWALL_STEP_COUNT, afterWelcomeHref, hardPaywallEnabled, hardPaywallState, hasIntroSteps, introTrialDays, isHardPaywallExempt } from '../src/lib/hardPaywall';
import { freeTrialDays, gateTrialByEligibility } from '../src/lib/billing';

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
});

describe('three-step paywall (ADR-0316)', () => {
    const product = (introPrice: { price: number; periodUnit: string; periodNumberOfUnits: number } | null) =>
        ({ identifier: 'starter_monthly', title: 'Starter', priceString: '$19.00', introPrice });

    it('reads a free trial from the store product, in days', () => {
        expect(freeTrialDays(product({ price: 0, periodUnit: 'DAY', periodNumberOfUnits: 7 }))).toBe(7);
        expect(freeTrialDays(product({ price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 1 }))).toBe(7);
    });

    it('does not call a paid intro offer, a missing offer or a malformed one a trial', () => {
        expect(freeTrialDays(product({ price: 0.99, periodUnit: 'MONTH', periodNumberOfUnits: 1 }))).toBeNull();
        expect(freeTrialDays(product(null))).toBeNull();
        expect(freeTrialDays({ identifier: 'x', title: 'x', priceString: '$1' })).toBeNull();
        expect(freeTrialDays(product({ price: 0, periodUnit: 'MONTH', periodNumberOfUnits: 1 }))).toBeNull();
        expect(freeTrialDays(product({ price: 0, periodUnit: 'YEAR', periodNumberOfUnits: 1 }))).toBeNull();
        expect(freeTrialDays(product({ price: 0, periodUnit: 'FORTNIGHT', periodNumberOfUnits: 1 }))).toBeNull();
        expect(freeTrialDays(product({ price: 0, periodUnit: 'DAY', periodNumberOfUnits: 0 }))).toBeNull();
    });

    it('shows the introduction only for a plan the store gives a trial on', () => {
        expect(introTrialDays([{ trialDays: 7 }], { trialDays: 7 })).toBe(7);
        expect(introTrialDays([{ trialDays: null }, { trialDays: 7 }], null)).toBe(7);
        expect(introTrialDays([{ trialDays: null }, { trialDays: 7 }], { trialDays: null })).toBe(0);
        expect(introTrialDays([{ trialDays: null }], { trialDays: null })).toBe(0);
        expect(introTrialDays([], null)).toBe(0);
    });

    it('has two introduction screens and then the plans', () => {
        expect(HARD_PAYWALL_STEP_COUNT).toBe(3);
        expect(hasIntroSteps(7, 1)).toBe(true);
        expect(hasIntroSteps(7, 2)).toBe(true);
        expect(hasIntroSteps(7, 3)).toBe(false);
        expect(hasIntroSteps(0, 1)).toBe(false);
    });

    it('shows an App Store trial only when the account is confirmed eligible; Google Play trusts the offer', () => {
        const plans = [{ productId: 'a', trialDays: 7 }, { productId: 'b', trialDays: 7 }];
        expect(gateTrialByEligibility(plans, 'ios', new Set(['a'])).map(p => p.trialDays)).toEqual([7, null]);
        expect(gateTrialByEligibility(plans, 'ios', null).map(p => p.trialDays)).toEqual([null, null]);
        expect(gateTrialByEligibility(plans, 'android', null).map(p => p.trialDays)).toEqual([7, 7]);
    });
});
