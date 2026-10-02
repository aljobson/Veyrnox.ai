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
