import * as SecureStore from 'expo-secure-store';
import { createPkce, type Pkce } from './pkce';

// The PKCE pair behind the link in a sign-up confirmation email. The user leaves the app to open the mail, so the
// verifier is kept in the Keychain / Keystore until the link brings the code back. It is useless without that code.
const KEY = 'veyrnox_confirm_pkce';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Stored extends Pkce { readonly at: number }

async function read(now: number): Promise<Pkce | null> {
    try {
        const raw = await SecureStore.getItemAsync(KEY);
        if (!raw) return null;
        const s = JSON.parse(raw) as Partial<Stored>;
        if (typeof s.verifier !== 'string' || typeof s.challenge !== 'string' || typeof s.at !== 'number') return null;
        if (now - s.at > MAX_AGE_MS) return null;
        return { verifier: s.verifier, challenge: s.challenge };
    } catch {
        return null;
    }
}

async function write(pkce: Pkce, now: number): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ ...pkce, at: now }), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
}

/** A fresh pair for a new sign-up. Replaces any earlier one. */
export async function beginEmailConfirm(now = Date.now()): Promise<string> {
    const pkce = await createPkce();
    try { await write(pkce, now); } catch { /* the link then opens the app signed out: the user signs in by hand */ }
    return pkce.challenge;
}

/** A resend keeps the stored pair so the first email's link still works; only a missing pair is replaced. */
export async function challengeForResend(now = Date.now()): Promise<string> {
    const stored = await read(now);
    return stored ? stored.challenge : beginEmailConfirm(now);
}

export async function readConfirmVerifier(now = Date.now()): Promise<string | null> {
    return (await read(now))?.verifier ?? null;
}

export async function clearEmailConfirm(): Promise<void> {
    try { await SecureStore.deleteItemAsync(KEY); } catch { /* nothing stored */ }
}
