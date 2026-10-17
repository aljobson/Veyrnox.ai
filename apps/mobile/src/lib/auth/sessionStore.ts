import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'veyrnox_refresh_token';

// Only the refresh token is persisted, in the Keychain / Keystore. Access
// tokens stay in memory, matching the web app (CLAUDE.md "Identity & sessions").
export async function readRefreshToken(): Promise<string | null> {
    try {
        return await SecureStore.getItemAsync(REFRESH_KEY);
    } catch {
        return null;
    }
}

export async function writeRefreshToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(REFRESH_KEY, token, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
}

export async function clearRefreshToken(): Promise<void> {
    try {
        await SecureStore.deleteItemAsync(REFRESH_KEY);
    } catch {
        // Nothing stored.
    }
}
