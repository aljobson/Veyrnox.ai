import { b64url, fromB64url, hmac as signature, verifyHmac } from '../signedToken.js';
const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;
import { isUuidLoose } from '../validate.js';
const MIN_SECRET_LENGTH = 32;

/** Keep approval signatures isolated even when the Worker binding limit requires a shared root secret. */
export function approvalSigningSecret(env = process.env) {
    const dedicated = env?.SOCIAL_APPROVAL_LINK_SECRET;
    if (typeof dedicated === 'string' && dedicated.length >= MIN_SECRET_LENGTH) return dedicated;
    const root = env?.SOCIAL_OAUTH_STATE_SECRET;
    return typeof root === 'string' && root.length >= MIN_SECRET_LENGTH
        ? `${root}:veyrnox:publish:approval:v1`
        : null;
}

export async function createApprovalToken({ reviewerId, expiresInSeconds = DEFAULT_TTL_SECONDS }, secret) {
    if (!isUuidLoose(reviewerId) || typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) throw new Error('invalid approval token input');
    const payload = new TextEncoder().encode(JSON.stringify({ r: reviewerId, e: Math.floor(Date.now() / 1000) + expiresInSeconds }));
    return `${b64url(payload)}.${b64url(await signature(payload, secret))}`;
}

export async function verifyApprovalToken(token, secret) {
    if (typeof token !== 'string' || token.length > 2048 || typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    let payload, supplied;
    try { payload = fromB64url(parts[0]); supplied = fromB64url(parts[1]); } catch { return null; }
    if (!await verifyHmac(payload, supplied, secret)) return null;
    let decoded;
    try { decoded = JSON.parse(new TextDecoder().decode(payload)); } catch { return null; }
    if (!isUuidLoose(decoded?.r) || typeof decoded?.e !== 'number' || decoded.e < Math.floor(Date.now() / 1000)) return null;
    return decoded.r;
}
