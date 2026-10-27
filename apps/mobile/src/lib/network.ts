import { t } from './i18n';
import { API_BASE, ApiError } from './api';

import { isOffline, markOffline, markOnline } from './networkState';
export { isOffline, markOffline, markOnline, subscribe, resetNetworkState } from './networkState';

// ApiClient reports a failure to connect as ApiError(0, 'network').
export function isNetworkError(err: unknown): boolean {
    return err instanceof ApiError && err.status === 0 && err.code === 'network';
}

// Call from a catch or a then to keep the state honest; returns the value so it can sit inside a chain.
export function observe<T>(result: Promise<T>): Promise<T> {
    return result.then(
        (value) => {
            markOnline();
            return value;
        },
        (err: unknown) => {
            if (isNetworkError(err)) markOffline();
            else markOnline();
            throw err;
        },
    );
}

export class OfflineError extends Error {
    constructor() {
        super('offline');
        this.name = 'OfflineError';
    }
}

// A paid action is never queued or retried later. Call this before submitting one: when the app knows it is offline
// it throws, and the screen shows the offline message instead of sending.
export function requireOnline(): void {
    if (isOffline()) throw new OfflineError();
}

const PROBE_TIMEOUT_MS = 4000;

// A cheap anonymous GET to our own API, to find out whether we really are offline.
export async function defaultProbe(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        await fetch(`${API_BASE}/api/catalog`, { method: 'HEAD', signal: controller.signal });
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

// Gate for every paid action. Online (or unknown): go ahead. Marked offline: probe once, because the mark can be
// stale after the network comes back; still unreachable means throw OfflineError and send nothing. The action is
// never queued for later.
export async function ensureOnline(probe: () => Promise<boolean> = defaultProbe): Promise<void> {
    if (!isOffline()) return;
    if (await probe()) {
        markOnline();
        return;
    }
    throw new OfflineError();
}

export const OFFLINE_PAID_MESSAGE = t('network.youareofflineNothingwassentand');
