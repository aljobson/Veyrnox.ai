import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicAlbumsEnabled, musicRpcStatus, publicMusicError, validMusicAuthId } from '../../../../../../lib/musicBackend.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request) {
    const auth = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(auth)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicAlbumsEnabled()) return reply({ error: 'albums_unavailable' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_list_album_artwork', { p_auth_id: auth }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ images: Array.isArray(result.images) ? result.images : [] });
    } catch { return reply({ error: 'temporarily_unavailable' }, 502); }
}
