import { b64url, fromB64url, hmac as hmac, verifyHmac } from '../signedToken.js';
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
    if (!await verifyHmac(payloadBytes, sigBytes, secret)) return null;

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
