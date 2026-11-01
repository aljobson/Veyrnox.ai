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
