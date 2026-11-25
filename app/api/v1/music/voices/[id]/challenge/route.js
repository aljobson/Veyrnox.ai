import { readMusicJson } from '../../../../../../../lib/musicBackend.js';
import { musicVoiceRequestDigest, parseMusicVoiceIdempotency, publicMusicVoiceProfile, validMusicVoiceId } from '../../../../../../../lib/musicVoices.js';
import { createMusicVoiceChallengeBundle, mfaTimestamp, musicVoiceContext, musicVoiceDb, musicVoiceRpcFailure, voiceReply } from '../../../../../../../lib/musicVoiceRuntime.js';

export async function POST(request, { params }) {
    const ctx = musicVoiceContext(request); if (ctx.error) return ctx.error;
    const { id } = await params; if (!validMusicVoiceId(id)) return voiceReply({ error: 'voice_id_invalid' }, 400);
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
        const profile = publicMusicVoiceProfile(result.profile); if (!profile) return voiceReply({ error: 'music_voice_unavailable' }, 503);
        const issued = result.reissued === true && result.idempotent !== true;
        return voiceReply({ profile, ...(issued ? { challenge: { phrase: challenge.phrase,
            expires_at: profile.challenge_expires_at } } : { challenge_reissue_required: true }), idempotent: result.idempotent === true });
    } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
}
