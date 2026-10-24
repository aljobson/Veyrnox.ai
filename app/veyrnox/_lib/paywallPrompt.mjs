// When to put the credit-pack paywall in front of a signed-in account.
// Pure so the rules are testable; PaywallPrompt.js holds the storage and UI.

// Below this many credits an account is "running low" (the signup grant is 10).
export const LOW_CREDIT_THRESHOLD = 10;
// An account this young still gets the first-visit paywall.
export const NEW_ACCOUNT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @returns {'first' | 'low' | 'depleted' | null}
 *   first — a new account that has not seen the paywall yet
 *   low   — balance under the threshold, not yet prompted this sign-in
 *   depleted — zero balance, not yet prompted for this depletion cycle
 */
export function paywallReason({ credits, createdAt, seenFirst, shownThisSession, shownDepletedBalance = false, now = Date.now() }) {
  if (!Number.isFinite(credits)) return null;
  // A depletion cycle is independent of the once-per-sign-in welcome/low
  // prompt. Buying credits resets shownDepletedBalance; spending back to zero
  // can therefore offer another Top-up without repeatedly nagging at zero.
  if (credits <= 0 && !shownDepletedBalance) return 'depleted';
  if (shownThisSession) return null;
  const created = Date.parse(createdAt);
  if (!seenFirst && Number.isFinite(created) && now - created < NEW_ACCOUNT_DAYS * DAY_MS) return 'first';
  if (credits < LOW_CREDIT_THRESHOLD) return 'low';
  return null;
}
