// Signed, expiring tokens for app/media/social/[token]/route.js — the
// server-mediated transfer TikTok's PULL_FROM_URL needs (ADR-0061 Phase 5).
//
// TikTok requires DNS-verifying the domain a PULL_FROM_URL points at
// (content-posting-api-media-transfer-guide) — an R2 presigned URL's host
// (<account>.r2.cloudflarestorage.com) is Cloudflare's, not ours, so it
// can never be verified there. This proxies the same object through our
// own verified domain instead: the token is opaque and short-lived, the
// object is fetched from R2 with our own service credentials (never a
// client-facing presigned URL), and the route streams the bytes straight
// through. Same HMAC shape as lib/social/oauthState.js — see that file for
// the rationale (no cookies, so state must carry its own binding).

const DEFAULT_TTL_SECONDS = 3600; // generous: TikTok's own fetch timing for PULL_FROM_URL isn't documented

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

/** Creates a signed, expiring token binding one R2 object to one proxy
 * fetch window. @param {{r2Key: string, expiresInSeconds?: number}} */
export async function createMediaProxyToken({ r2Key, expiresInSeconds = DEFAULT_TTL_SECONDS }, secret) {
    const payload = { k: r2Key, e: Math.floor(Date.now() / 1000) + expiresInSeconds };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const sig = await hmac(payloadBytes, secret);
    return `${b64url(payloadBytes)}.${b64url(sig)}`;
}

/** Verifies a proxy token and returns its r2Key, or null on any failure
 * (malformed, forged, or expired) — never throws, since this token is
 * fully attacker-controlled input on a public, unauthenticated route.
 * @returns {Promise<string|null>} */
export async function verifyMediaProxyToken(token, secret) {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    let payloadBytes, sigBytes;
    try {
        payloadBytes = fromB64url(parts[0]);
        sigBytes = fromB64url(parts[1]);
    } catch {
        return null;
    }
    const expected = await hmac(payloadBytes, secret);
    if (expected.length !== sigBytes.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ sigBytes[i];
    if (diff !== 0) return null; // constant-time compare

    let payload;
    try {
        payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    } catch {
        return null;
    }
    if (typeof payload.e !== 'number' || payload.e < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.k !== 'string' || !payload.k) return null;
    return payload.k;
}
