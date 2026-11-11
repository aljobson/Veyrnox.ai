import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import {
    musicLibraryEnabled, musicRpcStatus, parseMusicSongMove, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../../lib/musicBackend.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicLibraryEnabled()) return reply({ error: 'music_library_unavailable' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicSongMove(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_move_songs', {
            p_auth_id: authId,
            p_destination_workspace_id: input.destinationWorkspaceId,
            p_items: input.songs,
            p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ moved: result.moved, songs: result.songs || [] });
    } catch (error) {
        console.error('[music/songs/move] failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
