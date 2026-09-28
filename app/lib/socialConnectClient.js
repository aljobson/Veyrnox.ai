'use client';

/**
 * Client-side driver for Veyrnox Publish's connect flow (ADR-0061). Every
 * live network shares the same shape: POST /social/accounts/:network/connect
 * for an authorize URL, redirect, then POST /social/accounts/:network/
 * callback from app/social/connect/callback/[network]/page.js to finish it.
 *
 * PKCE mirrors app/lib/authClient.js's signInWithOAuth exactly (its own
 * randomVerifier/s256/PKCE_KEY are module-private, so this keeps its own
 * small copy under a different sessionStorage key rather than reaching
 * into that module's internals): this browser generates a verifier, sends
 * only its S256 challenge to /connect, then proves it holds the verifier
 * by sending it to /callback after the redirect. The verifier is stored
 * per network (not one shared key) so starting a second network's flow
 * before finishing the first can never clobber the first's verifier.
 */

import { gatewayFetch } from '../veyrnox/_lib/gateway.js';

export const NETWORKS = [
    { key: 'instagram', label: 'Instagram', live: true },
    { key: 'linkedin', label: 'LinkedIn', live: true },
    { key: 'twitter', label: 'X', live: true },
    // `live` only gates the Connect button — it genuinely works for
    // TikTok (packages/adapters/social/tiktok.js). Publishing does not
    // yet (that adapter's own header explains why), which only matters
    // once a composer/scheduling UI exists to promise it.
    { key: 'tiktok', label: 'TikTok', live: true },
    // Same story as TikTok: connect works (packages/adapters/social/
    // youtube.js), publishing does not yet — YouTube has no image-post
    // API at all, only a resumable video upload with its own design work
    // still to do.
    { key: 'youtube', label: 'YouTube', live: true },
];

function pkceKey(network) {
    return `veyrnox_social_pkce_verifier_${network}`;
}
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

/** Starts a network's OAuth flow: stores a PKCE verifier, then navigates
 * the browser to the provider's authorize page. Does not return on
 * success — the page unloads.
 * @param {string} network  one of NETWORKS' live keys, e.g. 'instagram' */
export async function connectNetwork(network) {
    const verifier = randomVerifier();
    sessionStorage.setItem(pkceKey(network), verifier);
    const { authorizeUrl } = await gatewayFetch(`/social/accounts/${network}/connect`, {
        method: 'POST',
        body: JSON.stringify({ codeChallenge: await s256(verifier) }),
    });
    window.location.assign(authorizeUrl);
}

/**
 * Finishes a network's flow from /social/connect/callback/:network: reads
 * `?code=&state=` off the current URL and the verifier this browser
 * stashed in connectNetwork(). Returns null (not an error) when this page
 * was opened without a code — a direct visit, not a real callback — so
 * the caller can show a neutral state instead of a failure.
 * @param {string} network
 * @returns {Promise<{ok:boolean, account?:object, code?:string}|null>}
 */
export async function completeNetworkConnect(network) {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return null;
    const codeVerifier = sessionStorage.getItem(pkceKey(network));
    sessionStorage.removeItem(pkceKey(network));
    if (!codeVerifier) return { ok: false, code: 'VERIFIER_MISSING' };

    try {
        return await gatewayFetch(`/social/accounts/${network}/callback`, {
            method: 'POST',
            body: JSON.stringify({ code, state, codeVerifier }),
        });
    } catch (err) {
        // A callback route answers an expected conflict (e.g. Instagram's
        // "no linked Business account") as { ok: false, code } rather than
        // gatewayFetch's usual { error } shape — read the raw body first so
        // that code survives, instead of gatewayFetch's generic
        // 'gateway_error' fallback.
        return { ok: false, code: (err && err.body && err.body.code) || (err && err.code) || 'connect_failed' };
    }
}

/** Disconnects one of the caller's own accounts. Throws GatewayError. */
export async function disconnectSocialAccount(accountId) {
    return gatewayFetch(`/social/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
}
