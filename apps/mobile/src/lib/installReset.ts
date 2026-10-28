import { retainDiscardedSession } from './auth/discardedSession';

// Keep this dependency graph free of theme, i18n and any other stored-state readers.
export const INSTALL_RESET_KEYS = [
    'veyrnox_refresh_token',
    'veyrnox.welcome.seen.v2',
    'veyrnox.language.v1', 'veyrnox.language.direction.v1',
    'veyrnox.theme', 'veyrnox.accent', 'veyrnox.typeface', 'veyrnox.textSize', 'veyrnox.theme.return',
    'veyrnox.analytics.consent.v1', 'veyrnox_push_pref',
    'veyrnox.celebrate.submissions.v1', 'veyrnox.celebrate.owner.v1', 'veyrnox.celebrate.first.v1',
    'veyrnox.celebrate.video.v1', 'veyrnox.celebrate.onboarding.v1',
    'veyrnox.vibe.v1', 'veyrnox.reviewAsk.v1', 'veyrnox.editorPrivacyNotice.v1',
] as const;
export const INSTALL_KEPT_KEYS = {
    veyrnox_push_device: 'Random device id, not personal data; preserves push registration identity.',
    'veyrnox.oddlings.legacy.v1': 'Legacy migration ownership fence; retaining it prevents another account from claiming existing Oddlings data.',
} as const;
// PaywallPrompt, AI consent and Oddlings are per-account keys, not device preferences.
// Leave them alone. MFA is different: mfaCheck namespaces enrolment by this install id.
export const INSTALL_MARKER = 'veyrnox.install.v1';
type Marker = { v: 1; state: 'pending' | 'complete'; installId: string };
type Step = 'marker_write' | 'marker_read' | 'delete';
let installId: string | null = null;
let failure: Step | null = null;
let reported = false;
let ran = false;
let reporter: ((message: string, tags: Record<string, string>) => void) | null = null;
export const getInstallId = () => installId;
const failed = (step: Step) => {
    if (!reported && !failure) failure = step;
    if (reporter) flushInstallResetIssue(reporter);
};

export function flushInstallResetIssue(report: (message: string, tags: Record<string, string>) => void): void {
    reporter = report; // Also deliver failures from async deletion/completion after Sentry starts.
    if (!failure || reported) return;
    report('install_reset_failed', { step: failure });
    failure = null;
    reported = true;
}

function parseMarker(raw: string): Marker | null {
    try {
        const value = JSON.parse(raw);
        return value?.v === 1 && (value.state === 'pending' || value.state === 'complete') &&
            typeof value.installId === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value.installId) ? value : null;
    } catch { return null; }
}

// Called synchronously by index.js, before requiring the router. Native failures never stop startup.
export function resetInstall(): void {
    if (ran) return;
    ran = true;
    let file: import('expo-file-system').File;
    let marker: Marker | null;
    try {
        const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
        file = new File(Paths.document, INSTALL_MARKER);
        marker = file.exists ? parseMarker(file.textSync()) : null;
    } catch { failed('marker_read'); return; }
    if (marker?.state === 'complete') { installId = marker.installId; return; }
    if (!marker) {
        try {
            const { randomUUID } = require('expo-crypto') as typeof import('expo-crypto');
            marker = { v: 1, state: 'pending', installId: randomUUID() };
            if (!file.exists) file.create();
            file.writeSync(JSON.stringify(marker));
        } catch { failed('marker_write'); return; }
        try {
            const saved = parseMarker(file.textSync());
            if (saved?.state !== 'pending' || saved.installId !== marker.installId) throw new Error('unverified');
        } catch { failed('marker_read'); return; }
    }
    installId = marker.installId;
    const complete = { ...marker, state: 'complete' };
    let wiped = true;
    const deletions: Promise<void>[] = [];
    try {
        const store = require('expo-secure-store') as typeof import('expo-secure-store');
        for (const key of INSTALL_RESET_KEYS) {
            let discarded: string | null = null;
            if (key === 'veyrnox_refresh_token') {
                try { discarded = store.getItem(key); } catch { failed('delete'); }
            }
            // SDK 58 SecureStore has no synchronous delete. Empty strings are absent to
            // every parser (and falsy to auth). Blank synchronously, then remove asynchronously.
            try { store.setItem(key, ''); } catch { wiped = false; failed('delete'); }
            // Even when the blanking throws, still discard the old session and queue the delete.
            if (discarded) retainDiscardedSession(discarded);
            const fail = () => { wiped = false; failed('delete'); };
            try { deletions.push(store.deleteItemAsync(key).catch(fail)); } catch { fail(); }
        }
    } catch { wiped = false; failed('delete'); }
    try {
        // Same file encoding as appStorage, without importing its stateful dependency graph.
        // A failure here is reported but does not hold the marker pending: re-wiping every launch
        // (and signing the person out each time) would be worse than one skipped welcome.
        const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
        const welcome = new File(Paths.cache, 'veyrnox-cache', `${encodeURIComponent('veyrnox.welcome.seen.v2')}.json`);
        if (welcome.exists) welcome.delete();
    } catch { failed('delete'); }
    void Promise.all(deletions).then(() => {
        if (!wiped) return; // Leave pending so an interrupted/failed wipe resumes on launch.
        try { file.writeSync(JSON.stringify(complete)); }
        catch { failed('marker_write'); }
        // If complete cannot be written, a later launch may clear a session created meanwhile.
        // This is limited to persistent completion-write failures; pending-write failures never wipe.
    });
}
