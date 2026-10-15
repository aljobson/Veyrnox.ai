const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_SECRET_LENGTH = 32;

/** Keep team-invite signatures isolated even when the Worker binding limit requires a shared root secret. */
export function teamInviteSigningSecret(env = process.env) {
    const dedicated = env?.SOCIAL_TEAM_INVITE_SECRET;
    if (typeof dedicated === 'string' && dedicated.length >= MIN_SECRET_LENGTH) return dedicated;
    const root = env?.SOCIAL_OAUTH_STATE_SECRET;
    return typeof root === 'string' && root.length >= MIN_SECRET_LENGTH
        ? `${root}:veyrnox:publish:team-invite:v1`
        : null;
}

function b64url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function sign(payload, secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
}

export async function createTeamInviteToken({ inviteId, expiresInSeconds = DEFAULT_TTL_SECONDS }, secret) {
    if (!UUID_RE.test(inviteId) || typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) throw new Error('invalid team invite token input');
    const payload = new TextEncoder().encode(JSON.stringify({ i: inviteId, e: Math.floor(Date.now() / 1000) + expiresInSeconds }));
    return `${b64url(payload)}.${b64url(await sign(payload, secret))}`;
}

export async function verifyTeamInviteToken(token, secret) {
    if (typeof token !== 'string' || token.length > 2048 || typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    let payload;
    let supplied;
    try { payload = fromB64url(parts[0]); supplied = fromB64url(parts[1]); } catch { return null; }
    const expected = await sign(payload, secret);
    if (expected.length !== supplied.length) return null;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ supplied[index];
    if (difference !== 0) return null;
    let decoded;
    try { decoded = JSON.parse(new TextDecoder().decode(payload)); } catch { return null; }
    if (!UUID_RE.test(decoded?.i) || !Number.isSafeInteger(decoded?.e) || decoded.e < Math.floor(Date.now() / 1000)) return null;
    return decoded.i;
}
