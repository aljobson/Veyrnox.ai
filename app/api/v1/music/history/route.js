import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { musicLibraryTabsEnabled, parseMusicListen } from '../../../../../lib/musicLibraryTabs.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function ready(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { error: reply({ error: 'not_authenticated' }, 401) };
    if (!musicLibraryTabsEnabled()) return { error: reply({ error: 'music_library_tabs_unavailable' }, 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: reply({ error: 'gateway_not_configured' }, 503) };
    return { authId, cfg };
}

export async function GET(request) {
    const gate = ready(request);
    if (gate.error) return gate.error;
    try {
        const result = await rpc('music_list_listen_history', { p_auth_id: gate.authId, p_limit: 50 }, gate.cfg);
        return reply({ songs: Array.isArray(result?.songs) ? result.songs : [] });
    } catch (error) {
        console.error('[music/history] list failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request) {
    const gate = ready(request);
    if (gate.error) return gate.error;
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicListen(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_record_listen', { p_auth_id: gate.authId, p_song_id: input.songId }, gate.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ recorded: true });
    } catch (error) {
        console.error('[music/history] record failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
