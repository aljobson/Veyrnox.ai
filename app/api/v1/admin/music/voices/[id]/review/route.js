import { adminGate, IDEMPOTENCY_RE } from '../../../../../../../../lib/adminGate.js';
import { freshAdminMfa, panelAccess, panelFailure, panelGateResponse, panelReply } from '../../../../../../../../lib/adminPanelApi.js';
import { readMusicJson } from '../../../../../../../../lib/musicBackend.js';
import { MUSIC_VOICE_POLICY_VERSION, MUSIC_VOICE_REVIEW_PERMISSION, musicVoiceRequestDigest, musicVoicesReady, parseMusicVoiceReview, publicMusicVoiceProfile, validMusicVoiceId } from '../../../../../../../../lib/musicVoices.js';
import { rpc } from '../../../../../../../../packages/db/supabase-client.js';

export async function POST(req, { params }) {
    const g = await adminGate(req); if (g.response) return panelGateResponse(g);
    if (!musicVoicesReady()) return panelReply({ error: 'not_found' }, 404);
    const { id } = await params; if (!validMusicVoiceId(id)) return panelReply({ error: 'voice_id_invalid' }, 400);
    const mfa = freshAdminMfa(req); if (!mfa) return panelReply({ error: 'mfa_required' }, 403);
    const key = req.headers.get('idempotency-key');
    if (!IDEMPOTENCY_RE.test(key || '') || key.length > 120) return panelReply({ error: 'idempotency_key_invalid' }, 400);
    const decoded = await readMusicJson(req, 4096); if (!decoded.ok) return panelReply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicVoiceReview(decoded.value); if (!input.ok) return panelReply({ error: input.error }, 400);
    const digest = await musicVoiceRequestDigest({ operation: 'review', profile_id: id, revision: input.revision,
        decision: input.decision, reason_code: input.reasonCode, checklist: input.checklist, policy_version: MUSIC_VOICE_POLICY_VERSION });
    try {
        await panelAccess(g, MUSIC_VOICE_REVIEW_PERMISSION);
        const result = await rpc('music_voice_admin_review', { p_auth_id: g.authId, p_profile_id: id,
            p_revision: input.revision, p_decision: input.decision, p_reason_code: input.reasonCode,
            p_checklist: input.checklist, p_idem_key: key, p_request_digest: digest,
            ...mfa, p_policy_version: MUSIC_VOICE_POLICY_VERSION }, g.cfg);
        if (!result?.ok) {
            const code = String(result?.code || 'voice_review_unavailable').toLowerCase();
            return panelReply({ error: code }, code === 'not_found' ? 404 : ['mfa_required','self_review_forbidden'].includes(code) ? 403
                : ['state_conflict','evidence_not_delivered','idempotency_conflict'].includes(code) ? 409 : 400);
        }
        const profile = publicMusicVoiceProfile(result.profile);
        return profile ? panelReply({ profile, idempotent: result.idempotent === true })
            : panelReply({ error: 'voice_review_unavailable' }, 503);
    } catch (error) { return panelFailure(error); }
}
