import * as SecureStore from 'expo-secure-store';
import { isAppLinkRoute } from './appLinks';

// A link opened while signed out: the app sends the person to sign in, and this keeps where the link was going so
// sign-in can finish there. One slot, fifteen minutes, removed once followed, and cleared on sign-out.
//
// What is kept is only a route the app's own link mapper produces (isAppLinkRoute), never the raw link. A team
// invitation's route carries its signed token, so the slot lives in the Keychain / Keystore, the same place as the
// refresh token and with the same this-device-only access, never in the plain app cache.
export const PENDING_LINK_SLOT = 'veyrnox.pendingLink.v1';
export const PENDING_LINK_TTL_MS = 15 * 60 * 1000;
// Screens outside the signed-in area open at once for anyone, so there is nothing to come back to.
const PUBLIC_ROUTE = /^\/review(?:\?|$)/;

export interface PendingLinkStore {
    get(): string | null;
    set(value: string): void;
    remove(): void;
}

export const securePendingLinkStore: PendingLinkStore = {
    get: () => SecureStore.getItem(PENDING_LINK_SLOT),
    set: (value) => SecureStore.setItem(PENDING_LINK_SLOT, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
    remove: () => { void SecureStore.deleteItemAsync(PENDING_LINK_SLOT).catch(() => undefined); },
};

/** The route worth keeping for after sign-in, or null for Home, a public screen or anything the link mapper does not produce. */
export function pendingLinkRoute(route: unknown): string | null {
    return isAppLinkRoute(route) && !PUBLIC_ROUTE.test(route) ? route : null;
}

/** Forget the kept destination. Never throws. */
export function forgetPendingLink(store: PendingLinkStore = securePendingLinkStore): void {
    try { store.remove(); } catch { /* storage blocked: nothing to clear */ }
}

/** Keep the destination of a link that opened the app. Returns whether one was kept; a refused route leaves the slot alone. */
export function rememberPendingLink(route: unknown, store: PendingLinkStore = securePendingLinkStore, now = Date.now()): boolean {
    const kept = pendingLinkRoute(route);
    if (!kept) return false;
    try {
        store.set(JSON.stringify({ route: kept, at: now }));
        return true;
    } catch {
        return false; // storage blocked: sign-in goes Home as before
    }
}

/** The kept destination, left in place, or null when there is none, it is not a mapped route or it has expired (then it is removed). */
export function recallPendingLink(store: PendingLinkStore = securePendingLinkStore, now = Date.now()): string | null {
    let raw: string | null;
    try { raw = store.get(); } catch { return null; }
    if (!raw) return null;
    let record: unknown;
    try { record = JSON.parse(raw); } catch { record = null; }
    const rec = record && typeof record === 'object' ? (record as { route?: unknown; at?: unknown }) : null;
    const route = rec ? pendingLinkRoute(rec.route) : null;
    const at = rec && typeof rec.at === 'number' && Number.isFinite(rec.at) ? rec.at : NaN;
    if (route === null || !(now - at <= PENDING_LINK_TTL_MS) || !(at <= now + PENDING_LINK_TTL_MS)) {
        forgetPendingLink(store);
        return null;
    }
    return route;
}

/** The kept destination, removed as it is read. */
export function takePendingLink(store: PendingLinkStore = securePendingLinkStore, now = Date.now()): string | null {
    const route = recallPendingLink(store, now);
    if (route !== null) forgetPendingLink(store);
    return route;
}
