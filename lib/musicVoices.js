import { musicRuntimeFlag } from './musicRuntime.js';
import { b64url, fromB64url } from './signedToken.js';

export const MUSIC_VOICE_CONSENT_VERSION = 'music-own-voice-2026-11-24';
export const MUSIC_VOICE_POLICY_VERSION = 'music-voice-review-v1';
export const MUSIC_VOICE_CHALLENGE_SECONDS = 20 * 60;
export const MUSIC_VOICE_PENDING_REVIEW_SECONDS = 7 * 24 * 60 * 60;
export const MUSIC_VOICE_VERIFICATION_SECONDS = 30 * 24 * 60 * 60;
export const MUSIC_VOICE_REFERENCE_MAX_SECONDS = 5 * 60;
export const MUSIC_VOICE_CHALLENGE_MAX_SECONDS = 60;
export const MUSIC_VOICE_MAX_BYTES = 20 * 1024 * 1024;
export const MUSIC_VOICE_REISSUE_LIMIT = 2;
export const MUSIC_VOICE_MFA_SECONDS = 5 * 60;
export const MUSIC_VOICE_REVIEW_PERMISSION = 'music_voices.review';
export const MUSIC_VOICE_APPROVE_PERMISSION = 'music_voices.approve';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,120}$/;
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav']);
const ENROLL_KEYS = new Set(['name', 'reference_source_key', 'owner_attestation', 'adult_attestation',
    'eligible_region_attestation', 'consent_version', 'idempotency_key']);
const VERIFY_KEYS = new Set(['challenge_source_key', 'phrase', 'live_recording_attestation', 'idempotency_key']);
const KEY_KEYS = new Set(['idempotency_key']);
const APPROVE_REASON = 'evidence_consistent';
const REJECT_REASONS = new Set(['phrase_mismatch', 'reference_mismatch',
    'synthetic_suspected', 'evidence_unreadable', 'policy_failed']);
const REVIEW_KEYS = new Set(['submission_revision', 'decision', 'reason_code', 'checklist']);
const CHECKLIST_KEYS = new Set(['phrase_exact', 'reference_consistent', 'no_synthetic_concerns', 'policy_acknowledged']);

// Eight independently chosen words (6 bits each) plus the slightly biased
// modulo-derived six-digit code carry at least 67.9 bits of min-entropy while
// staying readable over a recording.
const CHALLENGE_WORDS = Object.freeze([
    'amber', 'anchor', 'apple', 'arrow', 'atlas', 'badge', 'bamboo', 'beacon',
    'birch', 'bloom', 'bridge', 'bronze', 'cabin', 'canyon', 'cedar', 'cello',
    'cinder', 'clover', 'comet', 'coral', 'crane', 'dawn', 'delta', 'drift',
    'ember', 'fern', 'field', 'finch', 'fjord', 'flame', 'forest', 'frost',
    'garden', 'glade', 'granite', 'harbor', 'hazel', 'island', 'ivory', 'juniper',
    'lagoon', 'lantern', 'laurel', 'lilac', 'lotus', 'maple', 'meadow', 'meteor',
    'mist', 'moon', 'moss', 'ocean', 'olive', 'orchid', 'pebble', 'pine',
    'plume', 'quartz', 'raven', 'river', 'silver', 'spruce', 'stone', 'willow',
]);

const exactKeys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => allowed.has(key));
const utf8 = value => new TextEncoder().encode(value);

export function musicVoicesReady(env = process.env) {
    // This v1 secret derives both proof and sealing keys. Do not rotate it
    // while a challenge_issued or pending_review row exists; a future key-id
    // migration must provide a dual-key read window before rotation is safe.
    const secret = env.MUSIC_VOICE_CHALLENGE_SECRET;
    return musicRuntimeFlag('schema', env) && musicRuntimeFlag('library', env) && musicRuntimeFlag('voices', env)
        && musicVoicesSchemaReady(env) && env.UPLOAD_INTEGRITY_ENABLED === 'true'
        && typeof secret === 'string' && utf8(secret).length >= 32;
}

export function musicVoicesSchemaReady(env = process.env) {
    return env.MUSIC_VOICES_SCHEMA_ENABLED === 'true';
}

export function freshMusicVoiceMfa(request, nowSeconds = Math.floor(Date.now() / 1000)) {
    const raw = request.headers.get('x-veyrnox-auth-mfa-at');
    const at = /^\d{1,12}$/.test(raw || '') ? Number(raw) : NaN;
    return request.headers.get('x-veyrnox-auth-aal') === 'aal2' && Number.isSafeInteger(at)
        && at >= nowSeconds - MUSIC_VOICE_MFA_SECONDS && at <= nowSeconds + 5 ? at : null;
}

export function parseMusicVoiceEnrollment(value) {
    if (!exactKeys(value, ENROLL_KEYS)) return { ok: false, error: 'invalid_request' };
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) return { ok: false, error: 'name_invalid' };
    if (typeof value.reference_source_key !== 'string') return { ok: false, error: 'source_invalid' };
    if (value.owner_attestation !== true || value.adult_attestation !== true
        || value.eligible_region_attestation !== true) return { ok: false, error: 'attestation_required' };
    if (value.consent_version !== MUSIC_VOICE_CONSENT_VERSION) return { ok: false, error: 'consent_stale' };
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) return { ok: false, error: 'idempotency_key_invalid' };
    return { ok: true, name, referenceKey: value.reference_source_key, idempotencyKey: value.idempotency_key };
}

export function parseMusicVoiceVerification(value) {
    if (!exactKeys(value, VERIFY_KEYS)) return { ok: false, error: 'invalid_request' };
    const phrase = normalizeMusicVoicePhrase(value.phrase);
    if (!phrase || phrase.length > 160) return { ok: false, error: 'phrase_invalid' };
    if (typeof value.challenge_source_key !== 'string') return { ok: false, error: 'source_invalid' };
    if (value.live_recording_attestation !== true) return { ok: false, error: 'live_recording_required' };
    if (!IDEMPOTENCY_RE.test(value.idempotency_key || '')) return { ok: false, error: 'idempotency_key_invalid' };
    return { ok: true, challengeKey: value.challenge_source_key, phrase, idempotencyKey: value.idempotency_key };
}

export function parseMusicVoiceIdempotency(value) {
    return exactKeys(value, KEY_KEYS) && IDEMPOTENCY_RE.test(value.idempotency_key || '')
        ? { ok: true, idempotencyKey: value.idempotency_key }
        : { ok: false, error: 'idempotency_key_invalid' };
}

export function parseMusicVoiceEvidence(value) {
    if (!exactKeys(value, new Set(['submission_revision'])) || !Number.isSafeInteger(value.submission_revision)
        || value.submission_revision < 1) return { ok: false, error: 'revision_invalid' };
    return { ok: true, revision: value.submission_revision };
}

export function parseMusicVoiceReview(value) {
    if (!exactKeys(value, REVIEW_KEYS) || !Number.isSafeInteger(value.submission_revision)
        || value.submission_revision < 1 || !['approve', 'reject'].includes(value.decision)
        || (value.decision === 'approve' ? value.reason_code !== APPROVE_REASON : !REJECT_REASONS.has(value.reason_code))) {
        return { ok: false, error: 'review_invalid' };
    }
    if (!exactKeys(value.checklist, CHECKLIST_KEYS)
        || [...CHECKLIST_KEYS].some(key => typeof value.checklist[key] !== 'boolean')) {
        return { ok: false, error: 'checklist_invalid' };
    }
    if (value.decision === 'approve' && [...CHECKLIST_KEYS].some(key => value.checklist[key] !== true)) {
        return { ok: false, error: 'checklist_incomplete' };
    }
    return { ok: true, revision: value.submission_revision, decision: value.decision,
        reasonCode: value.reason_code, checklist: value.checklist };
}

export function validMusicVoiceId(value) { return UUID_RE.test(value || ''); }
export function validMusicVoiceAudio(type, sizeBytes, seconds, maxSeconds) {
    return AUDIO_TYPES.has(type) && Number.isSafeInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= MUSIC_VOICE_MAX_BYTES
        && Number.isFinite(seconds) && seconds >= 2 && seconds <= maxSeconds;
}

export function normalizeMusicVoicePhrase(value) {
    return typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

export function createMusicVoiceChallenge(random = crypto.getRandomValues.bind(crypto)) {
    const bytes = random(new Uint8Array(11));
    const words = Array.from(bytes.subarray(0, 8), byte => CHALLENGE_WORDS[byte & 63]);
    const number = ((bytes[8] << 16) | (bytes[9] << 8) | bytes[10]) % 1_000_000;
    return `${words.join(' ')} ${String(number).padStart(6, '0')}`;
}

export function createMusicVoiceNonce(random = crypto.getRandomValues.bind(crypto)) {
    return b64url(random(new Uint8Array(16)));
}

async function secretKey(secret, purpose) {
    const digest = await crypto.subtle.digest('SHA-256', utf8(`${purpose}\0${secret}`));
    return new Uint8Array(digest);
}

export async function musicVoiceChallengeProof({ profileId, nonce, phrase }, secret) {
    if (!validMusicVoiceId(profileId) || typeof nonce !== 'string' || nonce.length < 20) throw new Error('challenge_identity_invalid');
    const key = await crypto.subtle.importKey('raw', await secretKey(secret, 'music-voice-hmac'),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const data = utf8(`${profileId}\0${nonce}\0${normalizeMusicVoicePhrase(phrase)}`);
    return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, data)));
}

export async function sealMusicVoiceChallenge({ profileId, phrase }, secret, random = crypto.getRandomValues.bind(crypto)) {
    if (!validMusicVoiceId(profileId)) throw new Error('challenge_identity_invalid');
    const iv = random(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', await secretKey(secret, 'music-voice-seal'), 'AES-GCM', false, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(profileId) }, key,
        utf8(normalizeMusicVoicePhrase(phrase)));
    return `${b64url(iv)}.${b64url(new Uint8Array(encrypted))}`;
}

export async function openMusicVoiceChallenge({ profileId, sealed }, secret) {
    if (!validMusicVoiceId(profileId) || typeof sealed !== 'string') return null;
    const parts = sealed.split('.');
    if (parts.length !== 2) return null;
    try {
        const key = await crypto.subtle.importKey('raw', await secretKey(secret, 'music-voice-seal'), 'AES-GCM', false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(parts[0]), additionalData: utf8(profileId) },
            key, fromB64url(parts[1]));
        return normalizeMusicVoicePhrase(new TextDecoder().decode(plain));
    } catch { return null; }
}

export async function musicVoiceRequestDigest(value) {
    const bytes = await crypto.subtle.digest('SHA-256', utf8(JSON.stringify(value)));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function publicMusicVoiceProfile(row) {
    if (!row || typeof row !== 'object' || !validMusicVoiceId(row.id)) return null;
    const status = ['challenge_issued', 'pending_review', 'verified', 'rejected', 'revoked', 'expired'].includes(row.status)
        ? row.status : null;
    if (!status) return null;
    return {
        id: row.id, name: String(row.name || ''), status,
        submission_revision: Number(row.submission_revision) || 0,
        challenge_expires_at: row.challenge_expires_at || null,
        review_expires_at: row.review_expires_at || null,
        verified_at: row.verified_at || null,
        verification_expires_at: row.verification_expires_at || null,
        reason_code: status === 'rejected' ? 'not_verified' : null,
        created_at: row.created_at || null, updated_at: row.updated_at || null,
    };
}
