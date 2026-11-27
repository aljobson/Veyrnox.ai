import { readMusicJson } from '../../../../../../lib/musicBackend.js';
import {
    MUSIC_VOICE_CONSENT_VERSION, MUSIC_VOICE_POLICY_VERSION, musicVoiceChallengeProof,
    musicVoiceRequestDigest, musicVoicesReady, parseMusicVoiceEnrollment, parseMusicVoiceIdempotency,
    parseMusicVoiceVerification, publicMusicVoiceProfile, validMusicVoiceId,
} from '../../../../../../lib/musicVoices.js';
import {
    challengeLimit, createMusicVoiceChallengeBundle, inspectMusicVoiceUpload, mfaTimestamp,
    musicVoiceContext, musicVoiceDb, musicVoiceReadContext, musicVoiceRpcFailure, referenceLimit, voiceReply,
} from '../../../../../../lib/musicVoiceRuntime.js';

const routePath = async ({ params }) => {
    const value = (await params)?.voicePath;
    return Array.isArray(value) ? value : [];
};
const notFound = () => voiceReply({ error: 'not_found' }, 404);

async function listVoices(request) {
    const ctx = musicVoiceReadContext(request);
    if (ctx.error) return ctx.error;
    try {
        const result = await musicVoiceDb('music_voice_list', { p_auth_id: ctx.authId }, ctx.cfg);
        if (!result?.ok) return musicVoiceRpcFailure(result);
        return voiceReply({ profiles: (Array.isArray(result.profiles) ? result.profiles : [])
            .map(publicMusicVoiceProfile).filter(Boolean), policy: {
            consent_version: MUSIC_VOICE_CONSENT_VERSION, review_version: MUSIC_VOICE_POLICY_VERSION,
            verification_days: 30, provider_persona_created: false, enrollment_available: musicVoicesReady(ctx.env),
        } });
    } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
}

async function enrollVoice(request) {
    const ctx = musicVoiceContext(request);
    if (ctx.error) return ctx.error;
    const decoded = await readMusicJson(request, 4096);
    if (!decoded.ok) return voiceReply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicVoiceEnrollment(decoded.value);
    if (!input.ok) return voiceReply({ error: input.error }, 400);
    const digest = await musicVoiceRequestDigest({ operation: 'enroll', name: input.name,
        reference_key: input.referenceKey, consent_version: MUSIC_VOICE_CONSENT_VERSION,
        policy_version: MUSIC_VOICE_POLICY_VERSION });
    try {
        const prior = await musicVoiceDb('music_voice_enroll_context', { p_auth_id: ctx.authId,
            p_idem_key: input.idempotencyKey, p_request_digest: digest }, ctx.cfg);
        if (!prior?.ok) return musicVoiceRpcFailure(prior);
        if (prior.replay === true) {
            const profile = publicMusicVoiceProfile(prior.profile);
            return profile ? voiceReply({ profile, challenge_reissue_required: true, idempotent: true })
                : voiceReply({ error: 'music_voice_unavailable' }, 503);
        }
    } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
    const source = await inspectMusicVoiceUpload({ authId: ctx.authId, key: input.referenceKey,
        maxSeconds: referenceLimit, cfg: ctx.cfg });
    if (!source.ok) return voiceReply({ error: source.error }, source.status);
    const profileId = crypto.randomUUID();
    const challenge = await createMusicVoiceChallengeBundle(profileId, ctx.env.MUSIC_VOICE_CHALLENGE_SECRET);
    try {
        const result = await musicVoiceDb('music_voice_enroll', {
            p_auth_id: ctx.authId, p_profile_id: profileId, p_name: input.name, p_reference_key: source.key,
            p_reference_mime: source.mimeType, p_reference_size: source.sizeBytes, p_reference_seconds: source.seconds,
            p_nonce: challenge.nonce, p_hmac: challenge.proof, p_ciphertext: challenge.ciphertext,
            p_idem_key: input.idempotencyKey, p_request_digest: digest,
            p_aal: ctx.mfaAt === null ? 'aal1' : 'aal2', p_mfa_at: mfaTimestamp(ctx.mfaAt),
            p_consent_version: MUSIC_VOICE_CONSENT_VERSION, p_policy_version: MUSIC_VOICE_POLICY_VERSION,
        }, ctx.cfg);
        if (!result?.ok) return musicVoiceRpcFailure(result);
        const profile = publicMusicVoiceProfile(result.profile);
        if (!profile) return voiceReply({ error: 'music_voice_unavailable' }, 503);
        const issued = result.created === true && result.idempotent !== true;
        return voiceReply({ profile, ...(issued ? { challenge: {
            phrase: challenge.phrase, expires_at: profile.challenge_expires_at,
        } } : { challenge_reissue_required: true }), idempotent: result.idempotent === true }, issued ? 201 : 200);
    } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
}

async function revokeVoice(request, id) {
    const ctx = musicVoiceReadContext(request); if (ctx.error) return ctx.error;
    if (!validMusicVoiceId(id)) return voiceReply({ error: 'voice_id_invalid' }, 400);
    const headerKey = request.headers.get('idempotency-key');
    let input = parseMusicVoiceIdempotency({ idempotency_key: headerKey });
    if (!input.ok) {
        const decoded = await readMusicJson(request, 1024); if (!decoded.ok) return voiceReply({ error: decoded.error }, 400);
        input = parseMusicVoiceIdempotency(decoded.value); if (!input.ok) return voiceReply({ error: input.error }, 400);
    }
    const digest = await musicVoiceRequestDigest({ operation: 'revoke', profile_id: id });
    try {
        const result = await musicVoiceDb('music_voice_revoke', { p_auth_id: ctx.authId, p_profile_id: id,
            p_idem_key: input.idempotencyKey, p_request_digest: digest, p_aal: 'session', p_mfa_at: null }, ctx.cfg);
        if (!result?.ok) return musicVoiceRpcFailure(result);
        const profile = publicMusicVoiceProfile(result.profile);
        if (!profile) return voiceReply({ error: 'music_voice_unavailable' }, 503);
        return voiceReply({ profile, deletion_queued: result.deletion_queued === true,
            deletion_note: 'Private recordings are removed after their immutable upload grant expires and the reaper runs.',
            idempotent: result.idempotent === true });
    } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
}

async function reissueChallenge(request, id) {
    const ctx = musicVoiceContext(request); if (ctx.error) return ctx.error;
    if (!validMusicVoiceId(id)) return voiceReply({ error: 'voice_id_invalid' }, 400);
    const decoded = await readMusicJson(request, 1024); if (!decoded.ok) return voiceReply({ error: decoded.error }, 400);
    const input = parseMusicVoiceIdempotency(decoded.value); if (!input.ok) return voiceReply({ error: input.error }, 400);
    const challenge = await createMusicVoiceChallengeBundle(id, ctx.env.MUSIC_VOICE_CHALLENGE_SECRET);
    const digest = await musicVoiceRequestDigest({ operation: 'reissue', profile_id: id });
    try {
        const result = await musicVoiceDb('music_voice_reissue', { p_auth_id: ctx.authId, p_profile_id: id,
            p_nonce: challenge.nonce, p_hmac: challenge.proof, p_ciphertext: challenge.ciphertext,
            p_idem_key: input.idempotencyKey, p_request_digest: digest,
            p_aal: ctx.mfaAt === null ? 'aal1' : 'aal2', p_mfa_at: mfaTimestamp(ctx.mfaAt) }, ctx.cfg);
        if (!result?.ok) return musicVoiceRpcFailure(result);
        const profile = publicMusicVoiceProfile(result.profile);
        if (!profile) return voiceReply({ error: 'music_voice_unavailable' }, 503);
        const issued = result.reissued === true && result.idempotent !== true;
        return voiceReply({ profile, ...(issued ? { challenge: { phrase: challenge.phrase,
            expires_at: profile.challenge_expires_at } } : { challenge_reissue_required: true }),
            idempotent: result.idempotent === true });
    } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
}

async function submitChallenge(request, id) {
    const ctx = musicVoiceContext(request); if (ctx.error) return ctx.error;
    if (!validMusicVoiceId(id)) return voiceReply({ error: 'voice_id_invalid' }, 400);
    const decoded = await readMusicJson(request, 4096);
    if (!decoded.ok) return voiceReply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicVoiceVerification(decoded.value); if (!input.ok) return voiceReply({ error: input.error }, 400);
    const digest = await musicVoiceRequestDigest({ operation: 'submit', profile_id: id,
        challenge_key: input.challengeKey, phrase: input.phrase, live_recording_attestation: true });
    let challenge;
    try { challenge = await musicVoiceDb('music_voice_challenge_context', { p_auth_id: ctx.authId,
        p_profile_id: id, p_idem_key: input.idempotencyKey, p_request_digest: digest }, ctx.cfg); }
    catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
    if (!challenge?.ok) return musicVoiceRpcFailure(challenge);
    if (challenge.replay === true) {
        try {
            const result = await musicVoiceDb('music_voice_submit', { p_auth_id: ctx.authId, p_profile_id: id,
                p_challenge_key: '', p_challenge_mime: '', p_challenge_size: 0, p_challenge_seconds: 0,
                p_phrase_proof: '', p_idem_key: input.idempotencyKey, p_request_digest: digest,
                p_aal: ctx.mfaAt === null ? 'aal1' : 'aal2', p_mfa_at: mfaTimestamp(ctx.mfaAt) }, ctx.cfg);
            if (!result?.ok) return musicVoiceRpcFailure(result);
            const profile = publicMusicVoiceProfile(result.profile);
            return profile ? voiceReply({ profile, idempotent: true })
                : voiceReply({ error: 'music_voice_unavailable' }, 503);
        } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
    }
    if (typeof challenge.nonce !== 'string') return voiceReply({ error: 'music_voice_unavailable' }, 503);
    const source = await inspectMusicVoiceUpload({ authId: ctx.authId, key: input.challengeKey,
        maxSeconds: challengeLimit, cfg: ctx.cfg });
    if (!source.ok) return voiceReply({ error: source.error }, source.status);
    const proof = await musicVoiceChallengeProof({ profileId: id, nonce: challenge.nonce, phrase: input.phrase },
        ctx.env.MUSIC_VOICE_CHALLENGE_SECRET);
    try {
        const result = await musicVoiceDb('music_voice_submit', { p_auth_id: ctx.authId, p_profile_id: id,
            p_challenge_key: source.key, p_challenge_mime: source.mimeType, p_challenge_size: source.sizeBytes,
            p_challenge_seconds: source.seconds, p_phrase_proof: proof, p_idem_key: input.idempotencyKey,
            p_request_digest: digest, p_aal: ctx.mfaAt === null ? 'aal1' : 'aal2', p_mfa_at: mfaTimestamp(ctx.mfaAt) }, ctx.cfg);
        if (!result?.ok) return musicVoiceRpcFailure(result);
        const profile = publicMusicVoiceProfile(result.profile);
        return profile ? voiceReply({ profile, idempotent: result.idempotent === true })
            : voiceReply({ error: 'music_voice_unavailable' }, 503);
    } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
}

export async function GET(request, context) {
    return (await routePath(context)).length === 0 ? listVoices(request) : notFound();
}

export async function POST(request, context) {
    const path = await routePath(context);
    if (path.length === 0) return enrollVoice(request);
    if (path.length === 2 && path[1] === 'challenge') return reissueChallenge(request, path[0]);
    if (path.length === 2 && path[1] === 'verify') return submitChallenge(request, path[0]);
    return notFound();
}

export async function DELETE(request, context) {
    const path = await routePath(context);
    return path.length === 1 ? revokeVoice(request, path[0]) : notFound();
}
