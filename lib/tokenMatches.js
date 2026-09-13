/**
 * Constant-time shared-secret compare for internal endpoints: SHA-256 both
 * sides so the compared buffers are equal length, then compare without an
 * early exit. False for a missing or empty token on either side.
 *
 * @param {string|null|undefined} presented
 * @param {string|null|undefined} expected
 * @returns {Promise<boolean>}
 */
export async function tokenMatches(presented, expected) {
    if (typeof presented !== 'string' || !presented || typeof expected !== 'string' || !expected) return false;
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(presented)),
        crypto.subtle.digest('SHA-256', enc.encode(expected)),
    ]);
    const va = new Uint8Array(a);
    const vb = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
    return diff === 0;
}

/** The token from an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header) {
    const m = /^Bearer ([^\s]+)$/.exec(typeof header === 'string' ? header : '');
    return m ? m[1] : null;
}
