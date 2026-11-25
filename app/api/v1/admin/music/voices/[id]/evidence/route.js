import { adminGate } from '../../../../../../../../lib/adminGate.js';
import { freshAdminMfa, panelAccess, panelFailure, panelGateResponse, panelReply } from '../../../../../../../../lib/adminPanelApi.js';
import { MUSIC_VOICE_REVIEW_PERMISSION, musicVoicesReady, openMusicVoiceChallenge, parseMusicVoiceEvidence, validMusicVoiceId } from '../../../../../../../../lib/musicVoices.js';
import { readMusicJson } from '../../../../../../../../lib/musicBackend.js';
import { envConfig as r2Config, isConfigured, presignGetUrl } from '../../../../../../../../packages/adapters/r2.js';
import { rpc } from '../../../../../../../../packages/db/supabase-client.js';

export async function POST(req, { params }) {
    const g = await adminGate(req); if (g.response) return panelGateResponse(g);
    if (!musicVoicesReady()) return panelReply({ error: 'not_found' }, 404);
    const { id } = await params; if (!validMusicVoiceId(id)) return panelReply({ error: 'voice_id_invalid' }, 400);
    const mfa = freshAdminMfa(req); if (!mfa) return panelReply({ error: 'mfa_required' }, 403);
    const decoded = await readMusicJson(req, 1024); if (!decoded.ok) return panelReply({ error: decoded.error }, 400);
    const input = parseMusicVoiceEvidence(decoded.value); if (!input.ok) return panelReply({ error: input.error }, 400);
    const r2cfg = r2Config(); if (!isConfigured(r2cfg)) return panelReply({ error: 'storage_not_configured' }, 503);
    try {
        await panelAccess(g, MUSIC_VOICE_REVIEW_PERMISSION);
        const result = await rpc('music_voice_admin_evidence', { p_auth_id: g.authId, p_profile_id: id,
            p_revision: input.revision, ...mfa }, g.cfg);
        if (!result?.ok) {
            const code = String(result?.code || 'voice_review_unavailable').toLowerCase();
            return panelReply({ error: code }, ['not_found'].includes(code) ? 404
                : ['mfa_required','self_review_forbidden'].includes(code) ? 403 : code === 'evidence_rate_limit' ? 429 : 409);
        }
        const phrase = await openMusicVoiceChallenge({ profileId: id, sealed: result.challenge_ciphertext },
            process.env.MUSIC_VOICE_CHALLENGE_SECRET);
        if (!phrase || typeof result.reference_source_key !== 'string' || typeof result.challenge_source_key !== 'string') {
            return panelReply({ error: 'voice_evidence_unavailable' }, 503);
        }
        const [reference, challenge] = await Promise.all([
            presignGetUrl(result.reference_source_key, 300, r2cfg), presignGetUrl(result.challenge_source_key, 300, r2cfg),
        ]);
        return panelReply({ profile_id: id, submission_revision: input.revision, phrase,
            reference_url: reference.url, challenge_url: challenge.url, expires_in: 300,
            revocation_tail: 'A URL already issued may remain readable for up to five minutes after revocation.' });
    } catch (error) { return panelFailure(error); }
}
