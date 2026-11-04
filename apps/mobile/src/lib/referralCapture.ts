import * as SecureStore from 'expo-secure-store';
import { ApiError } from './api';
import { normalizeReferralCode } from './referrals';

// ADR-0071 / ADR-0115: a friend's link carries ?ref=<code>. When such a link opens the app, the code is kept on the device for three days
// (long enough to confirm an email and sign in; the server attributes only accounts under 48 hours old), then removed. Nothing is sent
// anywhere until the account is signed in. Mirrors app/veyrnox/_lib/referralCapture.js.
export const REFERRAL_SLOT = 'veyrnox.referral.v1';
export const REFERRAL_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const WEB_HOSTS = new Set(['veyrnox.ai', 'www.veyrnox.ai']);

export interface ReferralStore {
    get(): string | null;
    set(value: string): void;
    remove(): void;
}

export const secureReferralStore: ReferralStore = {
    get: () => {
        try { return SecureStore.getItem(REFERRAL_SLOT); } catch { return null; }
    },
    set: (value) => {
        try { SecureStore.setItem(REFERRAL_SLOT, value); } catch { /* storage blocked: nothing to carry */ }
    },
    remove: () => {
        try { void SecureStore.deleteItemAsync(REFERRAL_SLOT).catch(() => undefined); } catch { /* storage blocked */ }
    },
};

/** The code in a veyrnox.ai link's ?ref, or null for any other link or a malformed code. */
export function referralFromLink(link: string): string | null {
    let url: URL;
    try { url = new URL(link); } catch { return null; }
    if (url.protocol !== 'https:' || !WEB_HOSTS.has(url.hostname)) return null;
    return normalizeReferralCode(url.searchParams.get('ref'));
}

/** Keep the code from a link that opened the app. Returns whether one was kept. */
export function rememberReferralFromLink(link: string, store: ReferralStore = secureReferralStore, now = Date.now()): boolean {
    const code = referralFromLink(link);
    if (!code) return false;
    store.set(JSON.stringify({ code, at: now }));
    return true;
}

/** The remembered code, or null when there is none, it is malformed or it has expired (a broken or expired record is removed). */
export function recallReferral(store: ReferralStore = secureReferralStore, now = Date.now()): string | null {
    const raw = store.get();
    if (!raw) return null;
    let record: unknown;
    try { record = JSON.parse(raw); } catch { record = null; }
    const rec = record && typeof record === 'object' ? (record as { code?: unknown; at?: unknown }) : null;
    const code = rec ? normalizeReferralCode(rec.code) : null;
    const at = rec && typeof rec.at === 'number' && Number.isFinite(rec.at) ? rec.at : NaN;
    const fresh = code !== null && now - at <= REFERRAL_TTL_MS && at <= now + REFERRAL_TTL_MS;
    if (!fresh) {
        store.remove();
        return null;
    }
    return code;
}

/**
 * Whether an attach failure means "do not try again". An answer from the server about the code or the account is final. A sign-in,
 * rate-limit, server or network problem, or an account the server has not provisioned yet, is worth another try on the next visit.
 */
export function attachIsFinal(err: unknown): boolean {
    if (!(err instanceof ApiError)) return false;
    if (err.status === 404) return true; // the feature is off
    return (err.status === 400 || err.status === 409) && err.code !== 'user_not_provisioned';
}
