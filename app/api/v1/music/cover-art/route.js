import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { musicLibraryTabsEnabled } from '../../../../../lib/musicLibraryTabs.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicLibraryTabsEnabled()) return reply({ error: 'music_library_tabs_unavailable' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_list_cover_art', { p_auth_id: authId }, cfg);
        return reply({
            images: Array.isArray(result?.images) ? result.images : [],
            covers: Array.isArray(result?.covers) ? result.covers : [],
        });
    } catch (error) {
        console.error('[music/cover-art] list failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
