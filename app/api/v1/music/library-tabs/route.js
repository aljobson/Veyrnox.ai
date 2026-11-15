// Music Library tabs (0532): History, Hooks and Cover Art in one route, to
// keep the Worker bundle inside its budget.
//   GET  ?tab=history|hooks|covers
//   POST { action: 'listen', song_id }
//        { action: 'create_hook', song_id, version_id, title, start_seconds, end_seconds, idempotency_key }
//        { action: 'delete_hook', hook_id }
//        { action: 'set_cover', song_id, job_id | null }
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../../packages/adapters/r2.js';
import { inspectStoredSource } from '../../../../../lib/resolveSource.js';
import { musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { musicLibraryTabsEnabled, parseMusicLibraryTabAction } from '../../../../../lib/musicLibraryTabs.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const TABS = { history: ['music_list_listen_history', 'songs'], hooks: ['music_list_hooks', 'hooks'], covers: ['music_list_cover_art', null] };

function gate(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { error: reply({ error: 'not_authenticated' }, 401) };
    if (!musicLibraryTabsEnabled()) return { error: reply({ error: 'music_library_tabs_unavailable' }, 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: reply({ error: 'gateway_not_configured' }, 503) };
    return { authId, cfg };
}

export async function GET(request) {
    const g = gate(request);
    if (g.error) return g.error;
    const tab = new URL(request.url).searchParams.get('tab');
    if (!Object.hasOwn(TABS, tab || '')) return reply({ error: 'tab_invalid' }, 400);
    const [name, key] = TABS[tab];
    try {
        const result = await rpc(name, tab === 'history' ? { p_auth_id: g.authId, p_limit: 50 } : { p_auth_id: g.authId }, g.cfg);
        if (!key) return reply({ images: Array.isArray(result?.images) ? result.images : [], covers: Array.isArray(result?.covers) ? result.covers : [] });
        return reply({ [key]: Array.isArray(result?.[key]) ? result[key] : [] });
    } catch (error) {
        console.error('[music/library-tabs] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

async function createHook(input, g) {
    const r2cfg = r2EnvConfig();
    if (!r2IsConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
    const source = await rpc('music_get_hook_source_context', { p_auth_id: g.authId, p_song_id: input.songId, p_version_id: input.versionId }, g.cfg);
    if (!source?.ok) return reply({ error: publicMusicError(source?.code) }, musicRpcStatus(source?.code));
    const inspected = await inspectStoredSource(source.r2_key, { contentType: source.mime_type, field: 'audio_url' }, r2cfg);
    if (!inspected.ok || !Number.isFinite(inspected.seconds)) return reply({ error: 'source_duration_unavailable' }, 400);
    const result = await rpc('music_create_hook', {
        p_auth_id: g.authId, p_song_id: input.songId, p_version_id: input.versionId, p_title: input.title,
        p_start: input.start, p_end: input.end, p_duration: inspected.seconds, p_idempotency_key: input.idempotencyKey,
    }, g.cfg);
    if (!result?.ok) {
        const code = result?.code === 'INVALID_INPUTS' ? 'hook_range_invalid' : publicMusicError(result?.code);
        return reply({ error: code, duration_seconds: inspected.seconds }, musicRpcStatus(result?.code));
    }
    return reply({ hook_id: result.hook_id, ...(result.idempotent ? { idempotent: true } : {}) }, result.idempotent ? 200 : 201);
}

export async function POST(request) {
    const g = gate(request);
    if (g.error) return g.error;
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicLibraryTabAction(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        if (input.action === 'create_hook') return await createHook(input, g);
        if (input.action === 'listen') {
            const result = await rpc('music_record_listen', { p_auth_id: g.authId, p_song_id: input.songId }, g.cfg);
            return result?.ok ? reply({ recorded: true }) : reply({ error: 'not_found' }, 404);
        }
        if (input.action === 'delete_hook') {
            const result = await rpc('music_delete_hook', { p_auth_id: g.authId, p_hook_id: input.hookId }, g.cfg);
            return result?.ok ? reply({ deleted: result.deleted === true }) : reply({ error: 'not_found' }, 404);
        }
        const result = await rpc('music_set_song_cover', { p_auth_id: g.authId, p_song_id: input.songId, p_job_id: input.jobId }, g.cfg);
        return result?.ok ? reply({ cover_url: result.cover || null }) : reply({ error: 'not_found' }, 404);
    } catch (error) {
        console.error('[music/library-tabs] write failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
