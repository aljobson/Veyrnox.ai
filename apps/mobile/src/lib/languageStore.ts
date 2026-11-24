declare const require: (id: string) => any;
const secureStore = (): typeof import('expo-secure-store') => require('expo-secure-store');
import type { ApiClient } from './api';
import { LANGUAGE_SLOT, parseLanguage, serializeLanguage } from './language';

function fallbackFile(): import('expo-file-system').File {
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    return new File(Paths.document, `${LANGUAGE_SLOT}.json`);
}

function readFallback(): { present: boolean; raw: string | null } {
    try {
        const file = fallbackFile();
        return file.exists ? { present: true, raw: file.textSync() || null } : { present: false, raw: null };
    } catch {
        return { present: false, raw: null };
    }
}

function writeFallback(raw: string | null): boolean {
    try {
        fallbackFile().writeSync(raw ?? '');
        return true;
    } catch {
        return false;
    }
}

function readStoredLanguageRaw(): string | null {
    const fallback = readFallback();
    if (fallback.present) return fallback.raw;
    try { return secureStore().getItem(LANGUAGE_SLOT); } catch { return null; }
}

// Read synchronously before translated modules mount, like Appearance's startup settings.
export function readLanguage(): string | null {
    return parseLanguage(readStoredLanguageRaw());
}

export async function loadLanguage(): Promise<string | null> {
    return readLanguage();
}

export async function saveLanguage(code: string | null, pendingAccountSync = false): Promise<boolean> {
    const raw = code === null ? null : JSON.stringify({ ...JSON.parse(serializeLanguage(code)), pendingAccountSync });
    // Language is not secret. Documents storage is canonical so an unavailable Keychain can never block onboarding.
    // The synchronous Keychain read above remains only to migrate choices made by older app versions.
    return writeFallback(raw);
}

// The account keeps the choice too (the same call the website makes), so chat replies and the web follow it. English
// clears it, as on the site. Never blocks or fails the screen.
export async function saveAccountLanguage(api: Pick<ApiClient, 'request'>, code: string): Promise<void> {
    try {
        await api.request('/api/v1/account/language', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locale: code === 'en' ? null : code }),
        });
    } catch {
        // The display choice never waits for the account.
    }
}

export const storeLanguage = saveLanguage;

// Only an explicit pre-sign-in choice schedules this one-shot account update. Consume before sending,
// so remounts/relaunches cannot repeatedly overwrite an account preference changed elsewhere.
export async function syncPendingAccountLanguage(api: Pick<ApiClient, 'request'>, active: readonly string[]): Promise<void> {
    let code: string | null, raw: string | null;
    try {
        raw = readStoredLanguageRaw();
        code = parseLanguage(raw);
        if (!code || !active.includes(code) || !JSON.parse(raw!).pendingAccountSync) return;
    } catch { return; }
    if (!await saveLanguage(code)) return;
    await saveAccountLanguage(api, code);
}
