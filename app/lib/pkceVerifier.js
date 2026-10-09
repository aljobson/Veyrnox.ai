"use client";

/**
 * Where a PKCE verifier waits between starting a sign-in and /auth/callback.
 * Kept out of authClient.js, which is at the 500-line ceiling.
 *
 * OAuth: sessionStorage. The provider redirects back to the tab that started
 * the flow, and no other tab has a reason to read it.
 *
 * Magic link: localStorage. The emailed link opens a new tab, and a new tab
 * has its own empty sessionStorage, so the verifier has to be readable by the
 * whole browser. It is used once and ignored after MAGIC_VERIFIER_TTL_MS.
 *
 * A verifier left behind by an abandoned request cannot finish anyone else's
 * sign-in: Supabase accepts it only together with the one-time code from the
 * email it was issued for, and refuses a pair that does not belong together.
 */

const OAUTH_KEY = "veyrnox_pkce_verifier";
const MAGIC_KEY = "veyrnox_pkce_magic_verifier";
export const MAGIC_VERIFIER_TTL_MS = 15 * 60 * 1000;

/** @param {string} verifier */
export function keepOAuthVerifier(verifier) {
    sessionStorage.setItem(OAUTH_KEY, verifier);
}

/** @param {string} verifier */
export function keepMagicVerifier(verifier) {
    // The newest request in this tab wins, as it did when both used one key.
    sessionStorage.removeItem(OAUTH_KEY);
    localStorage.setItem(MAGIC_KEY, JSON.stringify({ verifier, at: Date.now() }));
}

/**
 * Read and delete the verifier for the callback being handled: this tab's
 * OAuth one if it has one, otherwise the browser's magic-link one.
 * @returns {string|null} null when there is none or it has expired
 */
export function takeVerifier() {
    const fromThisTab = sessionStorage.getItem(OAUTH_KEY);
    if (fromThisTab) {
        sessionStorage.removeItem(OAUTH_KEY);
        return fromThisTab;
    }
    const raw = localStorage.getItem(MAGIC_KEY);
    if (!raw) return null;
    localStorage.removeItem(MAGIC_KEY);
    try {
        const { verifier, at } = JSON.parse(raw);
        const age = Date.now() - at;
        if (typeof verifier !== "string" || !verifier) return null;
        return age >= 0 && age <= MAGIC_VERIFIER_TTL_MS ? verifier : null;
    } catch {
        return null;
    }
}
