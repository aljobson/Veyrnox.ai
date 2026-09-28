'use client';

/**
 * Client-side driver for Veyrnox Publish's connect flow (ADR-0061).
 * Instagram is the only network with a working server-side adapter today;
 * the rest are listed for the product surface but their connect action is
 * intentionally not wired up (NETWORKS below marks which are live).
 *
 * PKCE mirrors app/lib/authClient.js's signInWithOAuth exactly (its own
 * randomVerifier/s256/PKCE_KEY are module-private, so this keeps its own
 * small copy under a different sessionStorage key rather than reaching
 * into that module's internals): this browser generates a verifier, sends
 * only its S256 challenge to /connect, then proves it holds the verifier
 * by sending it to /callback after the redirect.
 */

import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const NETWORKS = [
    { key: 'instagram', label: 'Instagram', live: true },
    { key: 'twitter', label: 'X', live: false },
    { key: 'tiktok', label: 'TikTok', live: false },
    { key: 'linkedin', label: 'LinkedIn', live: false },
    { key: 'youtube', label: 'YouTube', live: false },
];

const PKCE_KEY = 'veyrnox_social_pkce_verifier';

function randomVerifier() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return b64url(bytes);
}
async function s256(input) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return b64url(new Uint8Array(digest));
}
function b64url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Lists the caller's connected accounts. Throws GatewayError on failure. */
export async function listSocialAccounts() {
    return gatewayFetch('/social/accounts');
}

/** Starts Instagram's OAuth flow: stores a PKCE verifier, then navigates
 * the browser to Meta's authorize page. Does not return on success —
 * the page unloads. */
export async function connectInstagram() {
    const verifier = randomVerifier();
    sessionStorage.setItem(PKCE_KEY, verifier);
    const { authorizeUrl } = await gatewayFetch('/social/accounts/instagram/connect', {
        method: 'POST',
        body: JSON.stringify({ codeChallenge: await s256(verifier) }),
    });
    window.location.assign(authorizeUrl);
}

/**
 * Finishes the Instagram flow from /social/connect/callback: reads
 * `?code=&state=` off the current URL and the verifier this browser
 * stashed in connectInstagram(). Returns null (not an error) when this
 * page was opened without a code — a direct visit, not a real callback —
 * so the caller can show a neutral state instead of a failure.
 * @returns {Promise<{ok:boolean, account?:object, code?:string}|null>}
 */
export async function completeInstagramConnect() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return null;
    const codeVerifier = sessionStorage.getItem(PKCE_KEY);
    sessionStorage.removeItem(PKCE_KEY);
    if (!codeVerifier) return { ok: false, code: 'VERIFIER_MISSING' };

    try {
        return await gatewayFetch('/social/accounts/instagram/callback', {
            method: 'POST',
            body: JSON.stringify({ code, state, codeVerifier }),
        });
    } catch (err) {
        // The route answers expected conflicts (e.g. no linked Instagram
        // account) as { ok: false, code } rather than gatewayFetch's usual
        // { error } shape — read the raw body first so that code survives,
        // instead of gatewayFetch's generic 'gateway_error' fallback.
        return { ok: false, code: (err && err.body && err.body.code) || (err && err.code) || 'connect_failed' };
    }
}

/** Disconnects one of the caller's own accounts. Throws GatewayError. */
export async function disconnectSocialAccount(accountId) {
    return gatewayFetch(`/social/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
}
