import { readMusicJson } from '../../../../../../../lib/musicBackend.js';
import { musicVoiceChallengeProof, musicVoiceRequestDigest, parseMusicVoiceVerification, publicMusicVoiceProfile, validMusicVoiceId } from '../../../../../../../lib/musicVoices.js';
import { challengeLimit, inspectMusicVoiceUpload, mfaTimestamp, musicVoiceContext, musicVoiceDb, musicVoiceRpcFailure, voiceReply } from '../../../../../../../lib/musicVoiceRuntime.js';

export async function POST(request, { params }) {
    const ctx = musicVoiceContext(request); if (ctx.error) return ctx.error;
    const { id } = await params; if (!validMusicVoiceId(id)) return voiceReply({ error: 'voice_id_invalid' }, 400);
    const decoded = await readMusicJson(request, 4096); if (!decoded.ok) return voiceReply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicVoiceVerification(decoded.value); if (!input.ok) return voiceReply({ error: input.error }, 400);
    const digest = await musicVoiceRequestDigest({ operation: 'submit', profile_id: id,
        challenge_key: input.challengeKey, phrase: input.phrase, live_recording_attestation: true });
    let challenge;
    try { challenge = await musicVoiceDb('music_voice_challenge_context', { p_auth_id: ctx.authId, p_profile_id: id,
        p_idem_key: input.idempotencyKey, p_request_digest: digest }, ctx.cfg); }
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
            if (!profile) return voiceReply({ error: 'music_voice_unavailable' }, 503);
            return voiceReply({ profile, idempotent: true });
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
        const profile = publicMusicVoiceProfile(result.profile); if (!profile) return voiceReply({ error: 'music_voice_unavailable' }, 503);
        return voiceReply({ profile, idempotent: result.idempotent === true });
    } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
}
