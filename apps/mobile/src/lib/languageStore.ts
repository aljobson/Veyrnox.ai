import * as SecureStore from 'expo-secure-store';
import type { ApiClient } from './api';
import { LANGUAGE_SLOT, parseLanguage, serializeLanguage } from './language';

// The phone's copy of the language choice. Only English is switched on in the app (ADR-0132), so a choice of another
// language is remembered, not shown, until that language goes live. A failed read means "never chose"; a failed write
// only means the card is asked again.
export async function loadLanguage(): Promise<string | null> {
    try {
        return parseLanguage(await SecureStore.getItemAsync(LANGUAGE_SLOT));
    } catch {
        return null;
    }
}

export async function storeLanguage(code: string): Promise<void> {
    try {
        await SecureStore.setItemAsync(LANGUAGE_SLOT, serializeLanguage(code));
    } catch {
        // Not saved: the card can be asked again.
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
