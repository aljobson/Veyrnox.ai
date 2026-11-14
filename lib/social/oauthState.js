import { b64url, fromB64url, hmac as hmac, verifyHmac } from '../signedToken.js';
// Signed OAuth `state` tokens (technical spec §2.7 "single-use, server-
// generated random value bound to the initiating session"). Social APIs use
// Bearer credentials, never the browser refresh cookie, so state carries its
// own binding instead of relying on
// server-side session storage: it's a compact signed token matching the HMAC primitive already used for Stripe's
// top_up_sig (packages/adapters/stripe.js) rather than inventing a new one.
//
// The PKCE code_verifier itself is never embedded here — it stays entirely
// client-side (sessionStorage), exactly like the existing Apple/Google flow
// (app/lib/authClient.js), so this token only needs to prove: which user
// started the flow, for which network, and that it hasn't expired or been
// tampered with. A random nonce makes every attempt distinct; oauthStateStore.js
// records its digest and atomically consumes it before a provider code is exchanged.

const STATE_TTL_SECONDS = 600; // 10 minutes — long enough for a consent screen, short enough to bound replay

// The signing secret keys HMAC-SHA256 (lib/signedToken.js) as a raw UTF-8
// string. A forgeable state token lets an attacker bind a connect to someone
// else's auth id, so the secret must carry real entropy, not a short
// placeholder. 32 bytes mirrors the exactly-32-byte requirement
// tokenCryptoConfig() enforces on SOCIAL_TOKEN_ENCRYPTION_KEY; a text secret
// is measured by its UTF-8 byte length.
const MIN_STATE_SECRET_BYTES = 32;

/** Loads and validates the OAuth state-signing secret from a Worker secret.
 * Returns null when SOCIAL_OAUTH_STATE_SECRET is missing or weaker than 32
 * bytes of entropy, so callers can degrade to a clean 503 rather than signing
 * state with a guessable key. */
export function oauthStateConfig(env = process.env) {
    const secret = env.SOCIAL_OAUTH_STATE_SECRET || '';
    if (new TextEncoder().encode(secret).length < MIN_STATE_SECRET_BYTES) return null;
    return { secret };
}

/** Boolean form of oauthStateConfig() for route guard clauses.
 * @returns {boolean} */
export function oauthStateSecretValid(env = process.env) {
    return oauthStateConfig(env) !== null;
}


/** Creates a signed, expiring state token binding one connect attempt to
 * the caller's own auth id and the target network. */
export async function createOAuthState({ authId, network }, secret) {
    const nonce = crypto.getRandomValues(new Uint8Array(24));
    const payload = {
        a: authId,
        n: network,
        e: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
        j: b64url(nonce),
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const sig = await hmac(payloadBytes, secret);
    return `${b64url(payloadBytes)}.${b64url(sig)}`;
}

/** Verifies a state token: signature, expiry, and that it was issued to
 * this same caller for this same network. Returns true/false only — never
 * throws on a malformed or forged token, since an attacker fully controls
 * this input (it round-trips through the browser and the provider). */
export async function verifyOAuthState(token, { authId, network }, secret) {
    if (typeof token !== 'string' || token.length > 2048) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    let payloadBytes, sigBytes;
    try {
        payloadBytes = fromB64url(parts[0]);
        sigBytes = fromB64url(parts[1]);
    } catch {
        return false;
    }
    if (!await verifyHmac(payloadBytes, sigBytes, secret)) return false;

    let payload;
    try {
        payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    } catch {
        return false;
    }
    if (typeof payload.e !== 'number' || payload.e < Math.floor(Date.now() / 1000)) return false;
    if (typeof payload.j !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(payload.j)) return false;
    return payload.a === authId && payload.n === network;
}

/** Stable, non-reversible key for the server-side one-use record. */
export async function oauthStateDigest(token) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
