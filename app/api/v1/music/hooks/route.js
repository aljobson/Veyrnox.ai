import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../../packages/adapters/r2.js';
import { inspectStoredSource } from '../../../../../lib/resolveSource.js';
import { musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { musicLibraryTabsEnabled, parseMusicHook } from '../../../../../lib/musicLibraryTabs.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicLibraryTabsEnabled()) return reply({ error: 'music_library_tabs_unavailable' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_list_hooks', { p_auth_id: authId }, cfg);
        return reply({ hooks: Array.isArray(result?.hooks) ? result.hooks : [] });
    } catch (error) {
        console.error('[music/hooks] list failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicLibraryTabsEnabled()) return reply({ error: 'music_library_tabs_unavailable' }, 404);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicHook(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const source = await rpc('music_get_hook_source_context', {
            p_auth_id: authId, p_song_id: input.songId, p_version_id: input.versionId,
        }, cfg);
        if (!source?.ok) return reply({ error: publicMusicError(source?.code) }, musicRpcStatus(source?.code));
        const inspected = await inspectStoredSource(source.r2_key, { contentType: source.mime_type, field: 'audio_url' }, r2cfg);
        if (!inspected.ok || !Number.isFinite(inspected.seconds)) return reply({ error: 'source_duration_unavailable' }, 400);
        const result = await rpc('music_create_hook', {
            p_auth_id: authId, p_song_id: input.songId, p_version_id: input.versionId, p_title: input.title,
            p_start: input.start, p_end: input.end, p_duration: inspected.seconds,
        }, cfg);
        if (!result?.ok) {
            const code = result?.code === 'INVALID_INPUTS' ? 'hook_range_invalid' : publicMusicError(result?.code);
            return reply({ error: code, duration_seconds: inspected.seconds }, musicRpcStatus(result?.code));
        }
        return reply({ hook_id: result.hook_id }, 201);
    } catch (error) {
        console.error('[music/hooks] create failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
