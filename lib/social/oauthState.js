// Signed OAuth `state` tokens (technical spec §2.7 "single-use, server-
// generated random value bound to the initiating session"). This app is
// Bearer/localStorage-only — no cookies anywhere (CLAUDE.md "Identity &
// sessions") — so state carries its own binding instead of relying on
// server-side session storage: it's a compact signed token, verified
// stateless, matching the HMAC primitive already used for Stripe's
// top_up_sig (packages/adapters/stripe.js) rather than inventing a new one.
//
// The PKCE code_verifier itself is never embedded here — it stays entirely
// client-side (sessionStorage), exactly like the existing Apple/Google flow
// (app/lib/authClient.js), so this token only needs to prove: which user
// started the flow, for which network, and that it hasn't expired or been
// tampered with. Meta (or any provider) echoes it back unmodified.

const STATE_TTL_SECONDS = 600; // 10 minutes — long enough for a consent screen, short enough to bound replay

function b64url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
    const bin = atob(padded);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function hmac(payloadBytes, secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, payloadBytes));
}

/** Creates a signed, expiring state token binding one connect attempt to
 * the caller's own auth id and the target network. */
export async function createOAuthState({ authId, network }, secret) {
    const payload = { a: authId, n: network, e: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS };
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
    const expected = await hmac(payloadBytes, secret);
    if (expected.length !== sigBytes.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ sigBytes[i];
    if (diff !== 0) return false; // constant-time compare

    let payload;
    try {
        payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    } catch {
        return false;
    }
    if (typeof payload.e !== 'number' || payload.e < Math.floor(Date.now() / 1000)) return false;
    return payload.a === authId && payload.n === network;
}
