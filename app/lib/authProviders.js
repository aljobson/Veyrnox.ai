// OAuth provider policy for the shared sign-in dialog. Apple and passkeys
// always have a place in the dialog; live settings gate starting an action.
// Google follows the build list. Unavailable methods explain what needs setup
// without navigating to Supabase's raw error page.

export const OAUTH_PROVIDERS = ['apple', 'google'];

/** @param {string|undefined} list comma-separated, e.g. "apple,google" */
export function configuredProviders(list) {
    const named = new Set(String(list || '').split(',').map((s) => s.trim()).filter(Boolean));
    return Object.fromEntries(OAUTH_PROVIDERS.map((p) => [p, named.has(p)]));
}

/**
 * Supabase's public auth settings, or null when they cannot be read (blocked,
 * offline, slow). Never throws: a null read must not hide anything.
 */
export async function readAuthSettings(url, anonKey, timeoutMs = 5000, fetcher = fetch) {
    if (!url || !anonKey) return null;
    try {
        const res = await fetcher(`${url}/auth/v1/settings`, {
            headers: { apikey: anonKey },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
}

/**
 * Whether to start an OAuth redirect for `provider`. Only a successful read
 * saying it is off stops it (that redirect would land on Supabase's raw 400);
 * an unreadable setting lets the user try, which is the point of the build list.
 */
export function providerAvailable(settings, provider) {
    if (!settings || typeof settings !== 'object') return true;
    const ext = settings.external && typeof settings.external === 'object' ? settings.external : {};
    return ext[provider] === true;
}

/** A visible passkey option explains missing support rather than disappearing. */
export function passkeyUnavailableReason(settings, supported) {
    if (!supported) return "This browser cannot use passkeys. Try a supported browser over HTTPS, or use another method.";
    if (settings && settings.passkeys_enabled !== true) return "Passkey sign-in isn't enabled for this environment yet. Use another method.";
    return null;
}
