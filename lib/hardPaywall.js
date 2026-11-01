// Hard paywall (ADR-0313): with the flag on, a signed-in account with no paid plan sees the paywall and nothing else.
// UI-level only: the server does not refuse anything on this flag. Read per request; exactly "true" turns it on.
export function hardPaywallEnabled(env = process.env) {
  return env.HARD_PAYWALL_ENABLED === 'true';
}
