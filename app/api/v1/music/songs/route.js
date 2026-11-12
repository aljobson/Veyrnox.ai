import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicLibraryEnabled, musicSchemaEnabled, musicRpcStatus, publicMusicError, validMusicAuthId } from '../../../../../lib/musicBackend.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
import { isUuid } from '../../../../../lib/validate.js';

export async function GET(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicSchemaEnabled()) return reply({ error: 'music_unavailable' }, 404);
    const search = new URL(request.url).searchParams;
    const rawLimit = search.get('limit');
    const limit = rawLimit === null ? 24 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return reply({ error: 'invalid_limit' }, 400);
    const workspaceId = search.get('workspace');
    const query = search.get('q') || '';
    const collection = search.get('collection') || 'active';
    if (workspaceId && !isUuid(workspaceId)) return reply({ error: 'workspace_id_invalid' }, 400);
    if (query.length > 100) return reply({ error: 'query_invalid' }, 400);
    if (!['active', 'trash'].includes(collection)) return reply({ error: 'collection_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const expanded = musicLibraryEnabled();
        if (!expanded && (workspaceId || query || collection !== 'active')) return reply({ error: 'music_library_unavailable' }, 404);
        const result = expanded
            ? await rpc('music_library_songs', {
                p_auth_id: authId,
                p_workspace_id: workspaceId || null,
                p_query: query || null,
                p_limit: limit,
                p_status: collection === 'trash' ? 'trashed' : 'active',
            }, cfg)
            : await rpc('music_list_songs', { p_auth_id: authId, p_limit: limit }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        if (!Array.isArray(result.songs)) return reply({ error: 'temporarily_unavailable' }, 502);
        return reply({ songs: result.songs });
    } catch (error) {
        console.error('[music/songs] rpc failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
