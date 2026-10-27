import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { appStorage } from './appCache';
import { FIRST_RUN_SLOT, claimWelcomeRedirect, hasSeenWelcome } from './firstRun';
import { isAnalyticsEnabled, readConsent } from './analytics/consent';
// Starts closed before any async gate read; survives navigation to the native policy.
let pending = true;
let checked = false;
let needsWelcome = false;
let user: string | null = null;
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function setFirstRunUser(id: string | null) {
    if (id === user) return;
    user = id;
    revision++;
    checked = false;
    needsWelcome = false;
    setFirstRunPending(id !== null);
}
export function useFirstRunUser() { return useSyncExternalStore(subscribe, () => user); }
export const isFirstRunPending = () => pending;
export function setFirstRunPending(value: boolean) { pending = value; listeners.forEach(fn => fn()); }
export function useFirstRunPending() {
    return useSyncExternalStore(subscribe, isFirstRunPending);
}
export async function firstRunDestination(): Promise<'/analytics-consent' | '/welcome' | null> {
    if (checked) return null;
    checked = true;
    const started = revision;
    const [secure, fallback, consent] = await Promise.all([
        SecureStore.getItemAsync(FIRST_RUN_SLOT).catch(() => null),
        appStorage.get(FIRST_RUN_SLOT).catch(() => null),
        isAnalyticsEnabled() ? readConsent() : Promise.resolve('denied'),
    ]);
    if (started !== revision) return null;
    needsWelcome = !hasSeenWelcome(secure) && !hasSeenWelcome(fallback);
    if (isAnalyticsEnabled() && consent === null) return '/analytics-consent';
    if (needsWelcome && claimWelcomeRedirect()) return '/welcome';
    setFirstRunPending(false);
    return null;
}
export function afterAnalyticsChoice(): '/welcome' | '/' {
    if (needsWelcome && claimWelcomeRedirect()) return '/welcome';
    setFirstRunPending(false);
    return '/';
}
