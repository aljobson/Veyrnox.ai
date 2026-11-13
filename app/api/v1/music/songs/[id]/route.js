import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import { musicAddSectionEnabled, musicCoverEnabled, musicDistributionEnabled, musicEditingEnabled, musicExtendEnabled, musicLibraryEnabled, musicPublicationEnabled, musicReplaceEnabled, musicReuseEnabled, musicRpcStatus, musicSchemaEnabled, musicStemsEnabled, musicStudioEnabled, musicTargetStemsEnabled, musicTrackAddEnabled, parseMusicSongLifecycle, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../../lib/musicBackend.js';

import { isUuid } from '../../../../../../lib/validate.js';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicSchemaEnabled()) return reply({ error: 'music_unavailable' }, 404);
    const { id } = await params;
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_get_song', { p_auth_id: authId, p_song_id: id }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        const actions = Array.isArray(result.song?.actions) ? result.song.actions : [];
        const distributionActions = musicDistributionEnabled()
            ? [...actions, 'share_link', 'download_mp3'] : actions;
        return reply({
            ...result.song,
            actions: [...new Set([
                ...distributionActions,
                ...(musicPublicationEnabled() ? ['publish'] : []),
                ...(musicCoverEnabled() ? ['cover'] : []),
                ...(musicExtendEnabled() ? ['extend'] : []),
                ...(musicReplaceEnabled() ? ['replace_section'] : []),
                ...(musicAddSectionEnabled() ? ['add_section'] : []),
                ...(musicReuseEnabled() && result.song?.generation_id ? ['reuse'] : []),
                ...(musicStemsEnabled() ? ['stems'] : []),
                ...(musicTargetStemsEnabled() ? ['target_stem'] : []),
                ...(musicTrackAddEnabled() ? ['add_track'] : []),
                ...(musicStudioEnabled() ? ['open_studio'] : []),
                ...(isUuid(result.song?.job_id || '') ? ['open_editor'] : []),
                ...(musicEditingEnabled() ? ['crop', 'render'] : []),
            ])],
        });
    } catch (error) {
        console.error('[music/songs/get] rpc failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function PATCH(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicLibraryEnabled()) return reply({ error: 'music_library_unavailable' }, 404);
    const { id } = await params;
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicSongLifecycle(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_set_song_lifecycle', {
            p_auth_id: authId,
            p_song_id: id,
            p_revision: input.revision,
            p_action: input.action,
        }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ song: result.song, idempotent: result.idempotent === true });
    } catch (error) {
        console.error('[music/songs/lifecycle] rpc failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
