// Recovery codes authorise removal of their bound TOTP factors, never an aal2 JWT.
export const COUNT = 10;
export const CODE_LENGTH = 10;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_RE = /^[0-9A-TV-Za-tv-z]{5}[ -]?[0-9A-TV-Za-tv-z]{5}$/;

export function generateRecoveryCodes(count = COUNT) {
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('invalid_code_count');
    const codes = new Set();
    while (codes.size < count) {
        // 256 is divisible by 32: masking is unbiased. Ten symbols carry 50 bits.
        const chars = Array.from(crypto.getRandomValues(new Uint8Array(CODE_LENGTH)), n => ALPHABET[n & 31]).join('');
        codes.add(`${chars.slice(0, 5)}-${chars.slice(5)}`);
    }
    return [...codes];
}

export function normalizeRecoveryCode(input) {
    if (typeof input !== 'string') return null;
    const code = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
    return code.length === CODE_LENGTH && [...code].every(c => ALPHABET.includes(c)) ? code : null;
}

export async function hashRecoveryCode(normalized, pepper, userId) {
    if (!pepper || typeof userId !== 'string' || !userId || typeof normalized !== 'string' || normalizeRecoveryCode(normalized) !== normalized) throw new Error('invalid_recovery_code');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${userId}:${normalized}`));
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
