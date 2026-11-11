import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicSchemaEnabled, validMusicAuthId } from '../../../../../../lib/musicBackend.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicSchemaEnabled()) return reply({ error: 'music_unavailable' }, 404);
    const { id } = await params;
    if (!UUID_RE.test(id || '')) return reply({ error: 'generation_id_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_get_generation', { p_auth_id: authId, p_request_id: id }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        return reply(result.generation);
    } catch (error) {
        console.error('[music/generations/get] rpc failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
