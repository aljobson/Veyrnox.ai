import { Platform } from 'react-native';
import type { ApiClient } from './api';
import { LANGUAGE_SLOT, parseLanguage, serializeLanguage } from './language';
declare const require: (id: string) => any;
const secureStore = (): typeof import('expo-secure-store') => require('expo-secure-store');

const iosLanguage = () => {
    if (Platform.OS !== 'ios') return null;
    try { return parseLanguage(require('react-native').Settings.get(LANGUAGE_SLOT) as string | null); } catch { return null; }
};
const mirrorIosLanguage = (value: string | null) => {
    if (Platform.OS !== 'ios') return false;
    try { require('react-native').Settings.set({ [LANGUAGE_SLOT]: value }); return true; } catch { return false; }
};

// Read synchronously before translated modules mount, like Appearance's startup settings.
export function readLanguage(): string | null {
    try { return parseLanguage(secureStore().getItem(LANGUAGE_SLOT)) ?? iosLanguage(); } catch { return iosLanguage(); }
}

export async function loadLanguage(): Promise<string | null> {
    try {
        return parseLanguage(await secureStore().getItemAsync(LANGUAGE_SLOT)) ?? iosLanguage();
    } catch {
        return iosLanguage();
    }
}

export async function saveLanguage(code: string | null, pendingAccountSync = false): Promise<boolean> {
    try {
        const value = code === null ? null : JSON.stringify({ ...JSON.parse(serializeLanguage(code)), pendingAccountSync });
        if (code === null) await secureStore().deleteItemAsync(LANGUAGE_SLOT);
        else await secureStore().setItemAsync(LANGUAGE_SLOT, value!);
        mirrorIosLanguage(value);
        return true;
    } catch {
        const value = code === null ? null : JSON.stringify({ ...JSON.parse(serializeLanguage(code)), pendingAccountSync });
        return mirrorIosLanguage(value);
    }
}

// The first-launch gate must update the synchronous startup read before it asks
// React to reveal sign-in. A cold iOS launch can leave the async native bridge
// promise pending even after Keychain has accepted this tiny write.
export function saveLanguageSync(code: string, pendingAccountSync = false): boolean {
    const value = JSON.stringify({ ...JSON.parse(serializeLanguage(code)), pendingAccountSync });
    try {
        secureStore().setItem(LANGUAGE_SLOT, value);
        mirrorIosLanguage(value);
        return true;
    } catch {
        return mirrorIosLanguage(value);
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
