'use client';

import { useHardPaywallLocked } from '../_lib/hardPaywallLock';

// ADR-0313: the shared Vey assistant (which can call /help) is not offered over the paywall.
export function HideWhileHardPaywall({ children }) {
  return useHardPaywallLocked() ? null : children;
}
