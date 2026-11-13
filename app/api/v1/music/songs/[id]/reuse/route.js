import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import {
    musicReuseEnabled, musicRpcStatus, parseMusicReuseDraft,
    publicMusicError, readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';

import { isUuid } from '../../../../../../../lib/validate.js';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function context(request, id) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return { response: reply({ error: 'not_authenticated' }, 401) };
    if (!musicReuseEnabled()) return { response: reply({ error: 'music_reuse_unavailable' }, 404) };
    if (!isUuid(id || '')) return { response: reply({ error: 'song_id_invalid' }, 400) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: reply({ error: 'gateway_not_configured' }, 503) };
    return { authId, cfg };
}

export async function GET(request, { params }) {
    const { id } = await params;
    const current = context(request, id);
    if (current.response) return current.response;
    const versionId = new URL(request.url).searchParams.get('version_id');
    if (!isUuid(versionId || '')) return reply({ error: 'version_id_invalid' }, 400);
    try {
        const result = await rpc('music_get_reuse_draft_context', {
            p_auth_id: current.authId, p_song_id: id, p_version_id: versionId,
        }, current.cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ source: result.source, draft_revision: result.draft_revision });
    } catch (error) {
        console.error('[music/reuse] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request, { params }) {
    const { id } = await params;
    const current = context(request, id);
    if (current.response) return current.response;
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicReuseDraft(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_apply_reuse_to_draft', {
            p_auth_id: current.authId, p_song_id: id, p_version_id: input.versionId,
            p_expected_revision: input.draftRevision, p_reuse_lyrics: input.reuseLyrics,
            p_reuse_styles: input.reuseStyles, p_idempotency_key: input.idempotencyKey,
        }, current.cfg);
        if (!result?.ok) return reply({
            error: publicMusicError(result?.code),
            ...(result?.code === 'REVISION_CONFLICT' && result.draft ? { draft: result.draft } : {}),
        }, musicRpcStatus(result?.code));
        return reply({ draft: result.draft, idempotent: result.idempotent === true });
    } catch (error) {
        console.error('[music/reuse] apply failed:', error?.message);
        return reply({ error: 'reuse_apply_unknown' }, 503);
    }
}
