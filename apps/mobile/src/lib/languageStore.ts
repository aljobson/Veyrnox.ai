declare const require: (id: string) => any;
const secureStore = (): typeof import('expo-secure-store') => require('expo-secure-store');
import type { ApiClient } from './api';
import { LANGUAGE_SLOT, parseLanguage, serializeLanguage } from './language';

// Read synchronously before translated modules mount, like Appearance's startup settings.
export function readLanguage(): string | null {
    try { return parseLanguage(secureStore().getItem(LANGUAGE_SLOT)); } catch { return null; }
}

export async function loadLanguage(): Promise<string | null> {
    try {
        return parseLanguage(await secureStore().getItemAsync(LANGUAGE_SLOT));
    } catch {
        return null;
    }
}

export async function saveLanguage(code: string | null, pendingAccountSync = false): Promise<boolean> {
    try {
        if (code === null) await secureStore().deleteItemAsync(LANGUAGE_SLOT);
        else await secureStore().setItemAsync(LANGUAGE_SLOT, JSON.stringify({ ...JSON.parse(serializeLanguage(code)), pendingAccountSync }));
        return true;
    } catch {
        return false;
    }
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
    let code: string | null;
    try {
        const raw = secureStore().getItem(LANGUAGE_SLOT);
        code = parseLanguage(raw);
        if (!code || !active.includes(code) || !JSON.parse(raw!).pendingAccountSync) return;
        secureStore().setItem(LANGUAGE_SLOT, serializeLanguage(code));
    } catch { return; }
    await saveAccountLanguage(api, code);
}
