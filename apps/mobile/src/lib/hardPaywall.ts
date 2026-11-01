import type { BillingStatus } from '../billing/BillingProvider';

// Hard paywall (ADR-0108 amendment 2): signed in without a paid plan means the paywall and nothing else.
// Off unless EXPO_PUBLIC_HARD_PAYWALL_ENABLED is exactly "true".
export const hardPaywallEnabled = (value: string | undefined = process.env.EXPO_PUBLIC_HARD_PAYWALL_ENABLED): boolean => value === 'true';

export type HardPaywallState = 'open' | 'checking' | 'locked';

export interface HardPaywallInputs {
    readonly enabled: boolean;
    readonly paidAccess: boolean;
    readonly accessResolved: boolean;
    readonly billingStatus: BillingStatus;
}

export function hardPaywallState({ enabled, paidAccess, accessResolved, billingStatus }: HardPaywallInputs): HardPaywallState {
    if (!enabled || paidAccess) return 'open';
    if (billingStatus === 'loading' || (billingStatus === 'ready' && !accessResolved)) return 'checking';
    return 'locked';
}

// Store rules: the person can always read the terms and delete their account. First-run screens (welcome, then the Vibe check) come before the paywall.
const EXEMPT = ['/delete-account', '/welcome', '/vibe', '/analytics-consent'];
export const isHardPaywallExempt = (pathname: string | null | undefined): boolean =>
    !!pathname && (EXEMPT.includes(pathname) || pathname.startsWith('/legal/'));

// Where the Welcome cards lead. Flag off: the Start screen, as before. Flag on: Welcome -> Vibe check -> paywall, so the
// next stop is the Vibe check (or, if that is not switched on in this build, straight to the gated app).
export function afterWelcomeHref(hard: boolean, vibeAvailable: boolean): '/start' | '/vibe?from=welcome' | '/' {
    if (!hard) return '/start';
    return vibeAvailable ? '/vibe?from=welcome' : '/';
}

// The first credits arrive when the person subscribes (owner, 2026-11-01), so the paywall quotes this fixed amount and
// never the account balance. Keep it equal to the sign-up grant (ADR-0013).
export const HARD_PAYWALL_STARTER_CREDITS = 10;

// ADR-0316: with a free trial on the chosen store plan the paywall is three screens (trial, control, plans). The trial
// length is whatever the store product says, so no screen promises a trial the store will not give.
export const HARD_PAYWALL_STEP_COUNT = 3;

/** Days of trial to introduce: the plan in view decides (no trial there means 0); with no plan in view, the first plan that has one. */
export function introTrialDays(plans: readonly { readonly trialDays?: number | null }[], chosen: { readonly trialDays?: number | null } | null): number {
    const days = chosen ? chosen.trialDays ?? 0 : plans.find(plan => (plan.trialDays ?? 0) > 0)?.trialDays ?? 0;
    return Number.isSafeInteger(days) && days > 0 ? days : 0;
}

/** The two introduction screens show only while there is a trial and the person has not reached the plans. */
export const hasIntroSteps = (trialDays: number, step: number): boolean => trialDays > 0 && step < HARD_PAYWALL_STEP_COUNT;
