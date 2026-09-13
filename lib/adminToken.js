/**
 * Shared-secret check for /api/admin/* endpoints called by schedulers.
 *
 * Constant-time compare via SHA-256 digests: equal-length inputs, no early
 * exit.
 */
export async function tokenMatches(presented, expected) {
    if (typeof presented !== 'string' || !presented) return false;
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
