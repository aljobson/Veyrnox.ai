import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { validMusicAuthId } from '../../../../../../lib/musicBackend.js';
import { musicLibraryTabsEnabled } from '../../../../../../lib/musicLibraryTabs.js';
import { isUuid } from '../../../../../../lib/validate.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function DELETE(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicLibraryTabsEnabled()) return reply({ error: 'music_library_tabs_unavailable' }, 404);
    if (!isUuid(id || '')) return reply({ error: 'hook_id_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_delete_hook', { p_auth_id: authId, p_hook_id: id }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        return reply({ deleted: result.deleted === true });
    } catch (error) {
        console.error('[music/hooks] delete failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
