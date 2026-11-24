import { admissionAvailable } from './uploadAdmission.js';
import { b64url, fromB64url, hmac, verifyHmac } from './signedToken.js';
import { musicRuntimeFlag } from './musicRuntime.js';

export const MUSIC_INSPIRATION_SOURCE_KINDS = Object.freeze(['audio', 'image', 'video_frames']);
export const MUSIC_INSPIRATION_AUDIO_MAX_BYTES = 8 * 1024 * 1024;
export const MUSIC_INSPIRATION_AUDIO_MAX_SECONDS = 90;
export const MUSIC_INSPIRATION_RECEIPT_VERSION = 1;
export const MUSIC_INSPIRATION_RECEIPT_TTL_SECONDS = 15 * 60;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEYS = new Set(['kind', 'key', 'rights_confirmed', 'idempotency_key']);
const RESULT_KEYS = new Set(['safe', 'brief', 'tags']);

const configured = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Source kinds the native iPhone may offer right now.
 *
 * The umbrella rollout flag is checked by the entitlement route. This second
 * gate reflects the contracts each picker needs, so the phone never uploads a
 * file merely to discover that its safety path is unavailable.
 */
export function musicInspirationSources(env = process.env) {
    if (!musicInspirationReady(env)) return [];
    return ['audio'];
}

export function musicInspirationReady(env = process.env) {
    if (!musicRuntimeFlag('schema', env) || !musicRuntimeFlag('inspiration', env)
        || env.MUSIC_INSPIRATION_ENABLED !== 'true'
        || !configured(env.MUSIC_INSPIRATION_MODEL)
        || !configured(env.MUSIC_INSPIRATION_API_KEY)
        || env.MUSIC_INSPIRATION_SCHEMA_ENABLED !== 'true'
        || env.UPLOAD_INTEGRITY_ENABLED !== 'true'
        || typeof env.MUSIC_INSPIRATION_RECEIPT_SECRET !== 'string'
        || new TextEncoder().encode(env.MUSIC_INSPIRATION_RECEIPT_SECRET).length < 32) return false;

    const admission = admissionAvailable(env);
    // The generic upload route closes every public upload when admission is
    // required but unavailable, including audio. Do not advertise a picker
    // that cannot complete its first network step.
    return admission.ok === true;
}

export function parseMusicInspirationRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Object.keys(value).every(key => REQUEST_KEYS.has(key))) return { ok: false, error: 'invalid_request' };
    if (value.kind !== 'audio') return { ok: false, error: 'source_not_supported' };
    if (typeof value.key !== 'string') return { ok: false, error: 'source_invalid' };
    if (value.rights_confirmed !== true) return { ok: false, error: 'source_rights_required' };
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) return { ok: false, error: 'idempotency_key_invalid' };
    return { ok: true, kind: 'audio', key: value.key, idempotencyKey: value.idempotency_key };
}

export function parseMusicInspirationResult(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Object.keys(value).every(key => RESULT_KEYS.has(key))
        || Object.keys(value).length !== RESULT_KEYS.size
        || typeof value.safe !== 'boolean') return { ok: false, error: 'provider_response_invalid' };
    const brief = typeof value.brief === 'string' ? value.brief.trim() : '';
    if (!brief || brief.length > 500 || !Array.isArray(value.tags) || value.tags.length > 8) {
        return { ok: false, error: 'provider_response_invalid' };
    }
    const tags = value.tags.map(tag => typeof tag === 'string' ? tag.trim() : null);
    if (tags.some(tag => !tag || tag.length > 40) || new Set(tags).size !== tags.length) {
        return { ok: false, error: 'provider_response_invalid' };
    }
    return { ok: true, safe: value.safe, brief, tags };
}

const canonical = value => new TextEncoder().encode(JSON.stringify(value));

export async function sha256Hex(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function issueMusicInspirationReceipt({ authId, analysisId, requestDigest, contentDigest, resultDigest, issuedAt, expiresAt }, secret) {
    if (!UUID_RE.test(authId || '') || !UUID_RE.test(analysisId || '')) throw new Error('receipt_identity_invalid');
    const payload = { v: MUSIC_INSPIRATION_RECEIPT_VERSION, sub: authId, aid: analysisId, req: requestDigest,
        content: contentDigest, result: resultDigest, iat: issuedAt, exp: expiresAt };
    const body = b64url(canonical(payload));
    return `${body}.${b64url(await hmac(new TextEncoder().encode(body), secret))}`;
}

export async function verifyMusicInspirationReceipt(token, authId, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    let payload;
    try {
        if (!(await verifyHmac(new TextEncoder().encode(parts[0]), fromB64url(parts[1]), secret))) return null;
        payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    } catch { return null; }
    return payload?.v === MUSIC_INSPIRATION_RECEIPT_VERSION && payload.sub === authId
        && UUID_RE.test(payload.aid || '') && Number.isSafeInteger(payload.iat) && Number.isSafeInteger(payload.exp)
        && payload.iat <= nowSeconds && payload.exp >= nowSeconds ? payload : null;
}
