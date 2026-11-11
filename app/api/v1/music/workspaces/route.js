import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import {
    musicLibraryEnabled, musicRpcStatus, parseMusicWorkspaceCreate, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../lib/musicBackend.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function context(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { response: reply({ error: 'not_authenticated' }, 401) };
    if (!musicLibraryEnabled()) return { response: reply({ error: 'music_library_unavailable' }, 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: reply({ error: 'gateway_not_configured' }, 503) };
    return { authId, cfg };
}

export async function GET(request) {
    const current = context(request);
    if (current.response) return current.response;
    try {
        const result = await rpc('music_list_workspaces', { p_auth_id: current.authId }, current.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        if (!Array.isArray(result.workspaces)) return reply({ error: 'temporarily_unavailable' }, 502);
        return reply({ workspaces: result.workspaces });
    } catch (error) {
        console.error('[music/workspaces] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request) {
    const current = context(request);
    if (current.response) return current.response;
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicWorkspaceCreate(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_create_workspace', {
            p_auth_id: current.authId,
            p_name: input.name,
            p_idempotency_key: input.idempotencyKey,
        }, current.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ workspace: result.workspace }, result.idempotent ? 200 : 201);
    } catch (error) {
        console.error('[music/workspaces] create failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
