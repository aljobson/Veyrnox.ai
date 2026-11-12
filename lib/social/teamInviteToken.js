import { b64url, fromB64url, hmac as sign, verifyHmac } from '../signedToken.js';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
import { isUuidLoose } from '../validate.js';
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



export async function createTeamInviteToken({ inviteId, expiresInSeconds = DEFAULT_TTL_SECONDS }, secret) {
    if (!isUuidLoose(inviteId) || typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) throw new Error('invalid team invite token input');
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
    if (!await verifyHmac(payload, supplied, secret)) return null;
    let decoded;
    try { decoded = JSON.parse(new TextDecoder().decode(payload)); } catch { return null; }
    if (!isUuidLoose(decoded?.i) || !Number.isSafeInteger(decoded?.e) || decoded.e < Math.floor(Date.now() / 1000)) return null;
    return decoded.i;
}
