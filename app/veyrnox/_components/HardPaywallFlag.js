'use client';

import { createContext, useContext } from 'react';

const HardPaywallFlag = createContext(false);

export function HardPaywallFlagProvider({ enabled, children }) {
  return <HardPaywallFlag.Provider value={enabled === true}>{children}</HardPaywallFlag.Provider>;
}

// True when the request-time server flag is on (ADR-0313).
export function useHardPaywallEnabled() {
  return useContext(HardPaywallFlag);
}
