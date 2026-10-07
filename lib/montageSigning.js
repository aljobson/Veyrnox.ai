/**
 * HMAC-SHA256 over `<t>.<raw body>` with a 300 s window, both directions
 * between the Worker and the montage runner (ADR-0074 §4). Same shape as the
 * Stripe adapter and the runner's own runner/signing.py. Web Crypto only.
 */

export const TOLERANCE_SECONDS = 300;
export const TIMESTAMP_HEADER = 'x-runner-timestamp';
export const SIGNATURE_HEADER = 'x-runner-signature';

const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function hmacKey(secret) {
    return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** @param {string} secret @param {Uint8Array|string} body @param {number} t unix seconds */
export async function signRunnerBody(secret, body, t) {
    const bytes = typeof body === 'string' ? enc.encode(body) : body;
    const msg = new Uint8Array(String(t).length + 1 + bytes.length);
    msg.set(enc.encode(`${t}.`), 0);
    msg.set(bytes, String(t).length + 1);
    return toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), msg));
}

/** Constant-time over equal-length hex; false on any malformed input. */
export async function verifyRunnerBody(secret, body, tHeader, sigHeader, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!secret || !/^\d{1,12}$/.test(String(tHeader || ''))) return false;
    const t = Number(tHeader);
    if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return false;
    const expected = await signRunnerBody(secret, body, t);
    const got = String(sigHeader || '');
    if (got.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
    return diff === 0;
}
