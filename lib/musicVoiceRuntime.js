import { envConfig, rpc, select } from '../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2Configured } from '../packages/adapters/r2.js';
import { inspectStoredSource } from './resolveSource.js';
import { ownsMusicVoiceUploadKey, typeForKey } from './uploadSource.js';
import { validMusicAuthId } from './musicBackend.js';
import {
    MUSIC_VOICE_CHALLENGE_MAX_SECONDS, MUSIC_VOICE_POLICY_VERSION, MUSIC_VOICE_REFERENCE_MAX_SECONDS,
    createMusicVoiceChallenge, createMusicVoiceNonce, freshMusicVoiceMfa, musicVoiceChallengeProof,
    musicVoicesReady, musicVoicesSchemaReady, sealMusicVoiceChallenge, validMusicVoiceAudio,
} from './musicVoices.js';

export const voiceReply = (body, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
});

export function musicVoiceContext(request, { requireMfa = false, env = process.env } = {}) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { error: voiceReply({ error: 'not_authenticated' }, 401) };
    if (!musicVoicesReady(env)) return { error: voiceReply({ error: 'music_voices_unavailable' }, 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: voiceReply({ error: 'gateway_not_configured' }, 503) };
    const mfaAt = freshMusicVoiceMfa(request);
    if (requireMfa && mfaAt === null) return { error: voiceReply({ error: 'recent_mfa_required' }, 403) };
    return { authId, cfg, env, mfaAt };
}

// Reading status and withdrawing consent must survive a rollout kill switch.
// The schema-ready flag is the only feature gate needed for these operations.
export function musicVoiceReadContext(request, { env = process.env, cfg = envConfig() } = {}) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { error: voiceReply({ error: 'not_authenticated' }, 401) };
    if (!musicVoicesSchemaReady(env)) return { error: voiceReply({ error: 'music_voices_unavailable' }, 404) };
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: voiceReply({ error: 'gateway_not_configured' }, 503) };
    return { authId, cfg, env, mfaAt: freshMusicVoiceMfa(request) };
}

export async function inspectMusicVoiceUpload({ authId, key, maxSeconds, cfg, r2cfg = r2EnvConfig() }) {
    if (!r2Configured(r2cfg)) return { ok: false, error: 'gateway_not_configured', status: 503 };
    if (!ownsMusicVoiceUploadKey(authId, key)) return { ok: false, error: 'source_not_found', status: 404 };
    const declared = typeForKey(key);
    if (!declared || declared.field !== 'audio_url') return { ok: false, error: 'source_not_supported', status: 400 };
    let reservation;
    try {
        const rows = await select('upload_reservations', { columns: 'r2_key,size_bytes,created_at',
            filter: `r2_key=eq.${encodeURIComponent(key)}`, limit: 1 }, cfg);
        reservation = rows?.[0];
    } catch { return { ok: false, error: 'source_check_unavailable', status: 503 }; }
    const expectedSize = Number(reservation?.size_bytes);
    if (reservation?.r2_key !== key || !Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
        return { ok: false, error: 'source_not_found', status: 404 };
    }
    const inspected = await inspectStoredSource(key, declared, r2cfg);
    if (!inspected.ok) return { ok: false, error: inspected.error, status: inspected.error === 'source_not_found' ? 404 : 400 };
    if (inspected.sizeBytes !== expectedSize || !validMusicVoiceAudio(inspected.contentType, inspected.sizeBytes,
        inspected.seconds, maxSeconds)) return { ok: false, error: 'source_invalid', status: 400 };
    return { ok: true, key, mimeType: inspected.contentType, sizeBytes: inspected.sizeBytes,
        seconds: inspected.seconds, reservedAt: reservation.created_at };
}

export async function createMusicVoiceChallengeBundle(profileId, secret) {
    const phrase = createMusicVoiceChallenge();
    const nonce = createMusicVoiceNonce();
    const [proof, ciphertext] = await Promise.all([
        musicVoiceChallengeProof({ profileId, nonce, phrase }, secret),
        sealMusicVoiceChallenge({ profileId, phrase }, secret),
    ]);
    return { phrase, nonce, proof, ciphertext };
}

export function musicVoiceRpcFailure(result, fallback = 'music_voice_unavailable') {
    const code = String(result?.code || fallback).toLowerCase();
    const status = {
        not_found: 404, source_not_found: 404, challenge_unavailable: 409, state_conflict: 409,
        active_profile: 409, idempotency_conflict: 409, challenge_expired: 409, challenge_mismatch: 422,
        reissue_limit: 429, rate_limited: 429, evidence_rate_limit: 429, mfa_required: 403,
        self_review_forbidden: 403, evidence_not_viewed: 409, evidence_not_delivered: 409,
        checklist_incomplete: 400, invalid: 400,
    }[code] || 503;
    return voiceReply({ error: code, ...(Number.isInteger(result?.attempts_remaining)
        ? { attempts_remaining: result.attempts_remaining } : {}) }, status);
}

export const musicVoiceDb = (name, args, cfg) => rpc(name, args, cfg);
export const mfaTimestamp = seconds => seconds === null ? null : new Date(seconds * 1000).toISOString();
export const referenceLimit = MUSIC_VOICE_REFERENCE_MAX_SECONDS;
export const challengeLimit = MUSIC_VOICE_CHALLENGE_MAX_SECONDS;
export const voicePolicyVersion = MUSIC_VOICE_POLICY_VERSION;
