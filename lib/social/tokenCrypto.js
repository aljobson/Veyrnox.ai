// AES-GCM encryption for OAuth tokens at rest (technical spec §2.7, ADR-0061
// §2.10). Web Crypto only — no jose, no external library, matching the
// bundler-trap discipline (CLAUDE.md "Bundler traps") already applied to
// lib/cinema/stream.js's HMAC/RS256 code. The key lives only in a dedicated
// Worker secret (SOCIAL_TOKEN_ENCRYPTION_KEY), never reused from any other
// subsystem, per ADR-0061 §2.11 risk 4.
//
// Ciphertext is stored as Postgres bytea: a 12-byte random IV followed by
// the AES-GCM output (tag included), hex-encoded as PostgREST expects bytea
// literals ("\\x...") over JSON.

const KEY_ALGO = { name: 'AES-GCM', length: 256 };
const IV_BYTES = 12;

/** Loads and validates the encryption key from a Worker secret. Returns
 * null on any misconfiguration rather than throwing, so callers can
 * degrade to a clean 503 instead of a stack trace. */
export function tokenCryptoConfig(env = process.env) {
    const encoded = env.SOCIAL_TOKEN_ENCRYPTION_KEY || '';
    if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return null; // base64 of exactly 32 bytes
    let raw;
    try {
        raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    } catch {
        return null;
    }
    if (raw.length !== 32) return null;
    return { raw };
}

async function importKey(cfg) {
    return crypto.subtle.importKey('raw', cfg.raw, KEY_ALGO, false, ['encrypt', 'decrypt']);
}

function toHexLiteral(bytes) {
    return '\\x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function fromHexLiteral(hex) {
    const clean = typeof hex === 'string' && hex.startsWith('\\x') ? hex.slice(2) : hex;
    if (typeof clean !== 'string' || clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
        throw new Error('invalid_bytea_literal');
    }
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    return bytes;
}

/** Encrypts a plaintext OAuth token. Returns a "\\x..." bytea literal
 * ready to send as an RPC parameter. */
export async function encryptToken(plaintext, cfg) {
    if (typeof plaintext !== 'string' || plaintext.length === 0) throw new Error('empty_plaintext');
    const key = await importKey(cfg);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
    );
    const combined = new Uint8Array(iv.length + ciphertext.length);
    combined.set(iv);
    combined.set(ciphertext, iv.length);
    return toHexLiteral(combined);
}

/** Decrypts a bytea value as PostgREST returns it ("\\x..." hex string)
 * back into the plaintext token. Throws on any tamper or misconfiguration
 * — never returns a partially-decrypted value. */
export async function decryptToken(byteaLiteral, cfg) {
    const combined = fromHexLiteral(byteaLiteral);
    if (combined.length <= IV_BYTES) throw new Error('ciphertext_too_short');
    const iv = combined.slice(0, IV_BYTES);
    const ciphertext = combined.slice(IV_BYTES);
    const key = await importKey(cfg);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
}
