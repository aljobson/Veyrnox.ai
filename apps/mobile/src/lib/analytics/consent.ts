import * as SecureStore from 'expo-secure-store';
export type AnalyticsChoice = 'granted' | 'denied' | null;
export const CONSENT_KEY = 'veyrnox.analytics.consent.v1';
export const isAnalyticsEnabled = () => !!process.env.EXPO_PUBLIC_POSTHOG_KEY?.startsWith('phc_');
let choice: AnalyticsChoice = null;
let revision = 0;
let timestamp = 0;
export const getConsentTimestamp = () => timestamp;
let reading: Promise<AnalyticsChoice> | undefined;
let writing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
export const getAnalyticsChoice = () => choice;
export function subscribeConsent(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function parseConsent(raw: string | null): AnalyticsChoice {
    try {
        const r = JSON.parse(raw ?? 'null');
        return r && !Array.isArray(r) && r.v === 1 && Number.isFinite(r.at) && r.at >= 0 && (r.choice === 'granted' || r.choice === 'denied') ? r.choice : null;
    } catch { return null; }
}
export function readConsent(): Promise<AnalyticsChoice> {
    if (!reading) {
        const start = revision;
        reading = SecureStore.getItemAsync(CONSENT_KEY).catch(() => null).then(raw => {
            if (revision === start) { choice = parseConsent(raw); timestamp = choice ? JSON.parse(raw!).at : 0; listeners.forEach(fn => fn()); }
            return choice;
        });
    }
    // Reuse the storage read, but not its stale result after an in-memory choice.
    return reading.then(() => choice);
}
export async function writeConsent(value: Exclude<AnalyticsChoice, null>): Promise<void> {
    const version = ++revision;
    // Revocation listeners run synchronously, before any storage await.
    if (value === 'denied') { choice = value; listeners.forEach(fn => fn()); }
    const at = Math.max(Date.now(), timestamp + version);
    // Preserve last-choice order even if the native store is slow. A pending
    // grant must never reactivate a client after a later decline.
    writing = writing.catch(() => undefined).then(() => SecureStore.setItemAsync(CONSENT_KEY, JSON.stringify({ v: 1, choice: value, at })));
    try { await writing; }
    catch (error) {
        // A decline already revoked collection in memory and must never block
        // navigation. A grant is valid only after it has been saved.
        // If the decline could not be saved, remove any earlier saved grant so a
        // restart asks again instead of resuming collection.
        if (value === 'denied') { await Promise.resolve().then(() => SecureStore.deleteItemAsync(CONSENT_KEY)).catch(() => undefined); return; }
        if (version === revision) { choice = null; listeners.forEach(fn => fn()); }
        throw error;
    }
    if (version !== revision) return;
    timestamp = at;
    choice = value;
    listeners.forEach(fn => fn());
}
