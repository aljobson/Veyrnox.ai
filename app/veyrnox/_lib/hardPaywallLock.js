'use client';

import { useEffect, useSyncExternalStore } from 'react';

// True while the hard paywall (ADR-0314) covers the app, so shared widgets outside the gate can step aside.
let locked = false;
const listeners = new Set();
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => locked;
const serverSnapshot = () => false;

function set(next) {
  if (locked === next) return;
  locked = next;
  listeners.forEach((listener) => listener());
}

export const useHardPaywallLocked = () => useSyncExternalStore(subscribe, snapshot, serverSnapshot);

// Call from a component that is on screen only while the paywall (or its checking screen) is.
export function useLockWhileMounted() {
  useEffect(() => { set(true); return () => set(false); }, []);
}
