// Web Crypto primitives only; payloads, domains and validation stay with callers.
export function b64url(bytes) {
    let binary = '';
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(value, { pad = true } = {}) {
    const encoded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(encoded + (pad ? '='.repeat((4 - value.length % 4) % 4) : ''));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export async function hmac(payload, secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
}

// Preserve textual comparisons (hex/base64url) separately from decoded bytes.
export function equalSignature(expected, supplied) {
    if (expected.length !== supplied.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) {
        difference |= typeof expected === 'string'
            ? expected.charCodeAt(index) ^ supplied.charCodeAt(index)
            : expected[index] ^ supplied[index];
    }
    return difference === 0;
}

export async function verifyHmac(payload, supplied, secret) {
    return equalSignature(await hmac(payload, secret), supplied);
}
