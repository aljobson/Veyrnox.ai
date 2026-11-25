import { adminGate } from '../../../../../../../../../lib/adminGate.js';
import { freshAdminMfa, panelAccess, panelFailure, panelGateResponse, panelReply } from '../../../../../../../../../lib/adminPanelApi.js';
import { readMusicJson } from '../../../../../../../../../lib/musicBackend.js';
import { MUSIC_VOICE_REVIEW_PERMISSION, musicVoicesReady, parseMusicVoiceEvidence, validMusicVoiceId } from '../../../../../../../../../lib/musicVoices.js';
import { rpc } from '../../../../../../../../../packages/db/supabase-client.js';

export async function POST(req, { params }) {
    const g = await adminGate(req); if (g.response) return panelGateResponse(g);
    if (!musicVoicesReady()) return panelReply({ error: 'not_found' }, 404);
    const { id } = await params; if (!validMusicVoiceId(id)) return panelReply({ error: 'voice_id_invalid' }, 400);
    const mfa = freshAdminMfa(req); if (!mfa) return panelReply({ error: 'mfa_required' }, 403);
    const decoded = await readMusicJson(req, 1024); if (!decoded.ok) return panelReply({ error: decoded.error }, 400);
    const input = parseMusicVoiceEvidence(decoded.value); if (!input.ok) return panelReply({ error: input.error }, 400);
    try {
        await panelAccess(g, MUSIC_VOICE_REVIEW_PERMISSION);
        const result = await rpc('music_voice_admin_evidence_delivered', { p_auth_id: g.authId, p_profile_id: id,
            p_revision: input.revision, ...mfa }, g.cfg);
        if (!result?.ok) {
            const code = String(result?.code || 'voice_review_unavailable').toLowerCase();
            return panelReply({ error: code }, code === 'not_found' ? 404
                : ['mfa_required','self_review_forbidden'].includes(code) ? 403 : 409);
        }
        return panelReply({ profile_id: id, submission_revision: input.revision, delivered: true });
    } catch (error) { return panelFailure(error); }
}
