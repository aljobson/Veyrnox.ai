import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import {
    musicRpcStatus, musicSchemaEnabled, parseMusicCustomDraft, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../../lib/musicBackend.js';

const reply = (body, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
});

function context(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { response: reply({ error: 'not_authenticated' }, 401) };
    if (!musicSchemaEnabled()) return { response: reply({ error: 'music_unavailable' }, 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: reply({ error: 'gateway_not_configured' }, 503) };
    return { authId, cfg };
}

export async function GET(request) {
    const current = context(request);
    if (current.response) return current.response;
    try {
        const result = await rpc('music_get_custom_draft', { p_auth_id: current.authId }, current.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ draft: result.draft });
    } catch (error) {
        console.error('[music/custom-draft] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function PUT(request) {
    const current = context(request);
    if (current.response) return current.response;
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicCustomDraft(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_save_custom_draft', {
            p_auth_id: current.authId,
            p_expected_revision: input.revision,
            p_model_id: input.modelId,
            p_lyrics: input.lyrics,
            p_styles: input.styles,
            p_title: input.title,
        }, current.cfg);
        if (!result?.ok) {
            return reply({
                error: publicMusicError(result?.code),
                ...(result?.code === 'REVISION_CONFLICT' ? { draft: result.draft } : {}),
            }, musicRpcStatus(result?.code));
        }
        return reply({ draft: result.draft });
    } catch (error) {
        console.error('[music/custom-draft] save failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
