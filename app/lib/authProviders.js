// Which OAuth buttons the sign-in dialog shows (components/AuthGate.jsx).
//
// The build's list (NEXT_PUBLIC_AUTH_PROVIDERS, from
// packages/security/environments.js) is the default, so the buttons render
// at once and on every page, whether or not the live settings read succeeds.
// The live read (`/auth/v1/settings`) can only remove one: a provider
// switched off in Supabase would otherwise redirect to a 400 page.

export const OAUTH_PROVIDERS = ['apple', 'google'];

/** @param {string|undefined} list comma-separated, e.g. "apple,google" */
export function configuredProviders(list) {
    const named = new Set(String(list || '').split(',').map((s) => s.trim()).filter(Boolean));
    return Object.fromEntries(OAUTH_PROVIDERS.map((p) => [p, named.has(p)]));
}

/** Narrow the configured set by a successful settings read; a failed read changes nothing. */
export function withLiveSettings(configured, settings) {
    if (!settings || typeof settings !== 'object') return configured;
    const ext = settings.external && typeof settings.external === 'object' ? settings.external : {};
    return Object.fromEntries(OAUTH_PROVIDERS.map((p) => [p, !!configured[p] && ext[p] === true]));
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
