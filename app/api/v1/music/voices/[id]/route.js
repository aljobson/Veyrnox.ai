import { readMusicJson } from '../../../../../../lib/musicBackend.js';
import { musicVoiceRequestDigest, parseMusicVoiceIdempotency, publicMusicVoiceProfile, validMusicVoiceId } from '../../../../../../lib/musicVoices.js';
import { musicVoiceDb, musicVoiceReadContext, musicVoiceRpcFailure, voiceReply } from '../../../../../../lib/musicVoiceRuntime.js';

export async function DELETE(request, { params }) {
    const ctx = musicVoiceReadContext(request); if (ctx.error) return ctx.error;
    const { id } = await params; if (!validMusicVoiceId(id)) return voiceReply({ error: 'voice_id_invalid' }, 400);
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
        const profile = publicMusicVoiceProfile(result.profile); if (!profile) return voiceReply({ error: 'music_voice_unavailable' }, 503);
        return voiceReply({ profile, deletion_queued: result.deletion_queued === true,
            deletion_note: 'Private recordings are removed after their immutable upload grant expires and the reaper runs.',
            idempotent: result.idempotent === true });
    } catch { return voiceReply({ error: 'music_voice_unavailable' }, 503); }
}
