// Hard paywall decisions (ADR-0313). Pure so every state is testable; HardPaywallGate.jsx holds the fetching and UI.

// Keep equal to the sign-up grant (ADR-0013). The paywall quotes this fixed amount, never the balance.
export const HARD_PAYWALL_STARTER_CREDITS = 10;

const LIVE_STATUSES = ['active', 'past_due'];

/** A plan counts when its subscription is live. Pending, ended and flagged rows do not. */
export const isLivePlan = (subscription) => Boolean(subscription) && LIVE_STATUSES.includes(subscription.status);

/**
 * @param {{ enabled: boolean, signedIn: boolean, generation: object | null | undefined, publish: object | null | undefined, failed: boolean }} input
 *   generation / publish: undefined while loading, null when the account has none.
 *   failed: the AI Generation read failed (a Publish read that fails only means no Publish plan).
 * @returns {'open' | 'checking' | 'unknown' | 'locked'}
 */
export function hardPaywallState({ enabled, signedIn, generation, publish, failed }) {
  if (!enabled || !signedIn) return 'open';
  if (isLivePlan(generation) || isLivePlan(publish)) return 'open';
  if (failed) return 'unknown';
  if (generation === undefined || publish === undefined) return 'checking';
  return 'locked';
}

// Admin tools carry their own Access and second-factor checks, and operators need them without a plan.
const EXEMPT_PREFIXES = ['/app/admin'];
export const isHardPaywallExempt = (pathname) =>
  typeof pathname === 'string' && EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
