import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicTargetStemsEnabled, validMusicAuthId } from '../../../../../../lib/musicBackend.js';

import { isUuid } from '../../../../../../lib/validate.js';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id'); const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicTargetStemsEnabled()) return reply({ error: 'music_target_stems_unavailable' }, 404);
    if (!isUuid(id || '')) return reply({ error: 'request_id_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_get_target_stem_request', {
            p_auth_id: authId, p_request_id: id,
        }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        return reply(result.request);
    } catch (error) {
        console.error('[music/target-stem-request] failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
