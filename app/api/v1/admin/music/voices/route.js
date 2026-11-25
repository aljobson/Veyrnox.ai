import { adminGate } from '../../../../../../lib/adminGate.js';
import { panelAccess, panelFailure, panelGateResponse, panelReply } from '../../../../../../lib/adminPanelApi.js';
import { MUSIC_VOICE_REVIEW_PERMISSION, musicVoicesReady } from '../../../../../../lib/musicVoices.js';
import { rpc } from '../../../../../../packages/db/supabase-client.js';

export async function GET(req) {
    const g = await adminGate(req); if (g.response) return panelGateResponse(g);
    if (!musicVoicesReady()) return panelReply({ error: 'not_found' }, 404);
    try {
        await panelAccess(g, MUSIC_VOICE_REVIEW_PERMISSION);
        const result = await rpc('music_voice_admin_list', { p_auth_id: g.authId }, g.cfg);
        return result?.ok && Array.isArray(result.profiles)
            ? panelReply({ profiles: result.profiles }) : panelReply({ error: 'voice_review_unavailable' }, 503);
    } catch (error) { return panelFailure(error); }
}
