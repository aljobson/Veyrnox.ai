import * as SecureStore from 'expo-secure-store';

// Which accounts have already passed the two-factor check in this launch. The check asks the server who the person is,
// so a screen that remounts must not ask again: it reads this instead. Held in memory only, so every launch asks once.
const cleared = new Set<string>();

export const mfaClearedFor = (userId: string | null): boolean => !!userId && cleared.has(userId);

export function markMfaCleared(userId: string | null): void {
    if (userId) cleared.add(userId);
}

// Sign-out: the next person to sign in is asked afresh.
export function forgetMfaCleared(): void {
    cleared.clear();
}

// What the last completed check on this phone said about each account: does it have a verified authenticator?
// Used only when a check cannot finish (offline, slow server): an account this phone has seen without two-factor
// opens as before. Unknown counts as enrolled, so a fresh install signed in with a stolen password still stops.
const enrolmentKey = (userId: string) => `veyrnox_mfa_enrolled_${userId.replace(/[^A-Za-z0-9_-]/g, '')}`;

export async function knownMfaEnrolment(userId: string | null): Promise<boolean | null> {
    if (!userId) return null;
    try {
        const stored = await SecureStore.getItemAsync(enrolmentKey(userId));
        return stored === '1' ? true : stored === '0' ? false : null;
    } catch {
        return null;
    }
}

export async function rememberMfaEnrolment(userId: string | null, enrolled: boolean): Promise<void> {
    if (!userId) return;
    try {
        await SecureStore.setItemAsync(enrolmentKey(userId), enrolled ? '1' : '0', {
            keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
    } catch {
        // Not remembered: the next unfinished check treats the account as enrolled, the safe side.
    }
}
