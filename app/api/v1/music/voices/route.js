import { readMusicJson } from '../../../../../lib/musicBackend.js';
import {
    MUSIC_VOICE_CONSENT_VERSION, MUSIC_VOICE_POLICY_VERSION, musicVoiceRequestDigest, musicVoicesReady,
    parseMusicVoiceEnrollment, publicMusicVoiceProfile,
} from '../../../../../lib/musicVoices.js';
import {
    createMusicVoiceChallengeBundle, inspectMusicVoiceUpload, mfaTimestamp, musicVoiceContext,
    musicVoiceDb, musicVoiceReadContext, musicVoiceRpcFailure, referenceLimit, voiceReply,
} from '../../../../../lib/musicVoiceRuntime.js';

export async function GET(request) {
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

export async function POST(request) {
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
            p_idem_key: input.idempotencyKey, p_request_digest: digest, p_aal: ctx.mfaAt === null ? 'aal1' : 'aal2', p_mfa_at: mfaTimestamp(ctx.mfaAt),
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
