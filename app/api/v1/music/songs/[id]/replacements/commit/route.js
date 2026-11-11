import { rpc, envConfig } from '../../../../../../../../packages/db/supabase-client.js';
import {
    musicReplaceEnabled, musicRpcStatus, parseMusicReplaceCommit,
    publicMusicError, readMusicJson, validMusicAuthId,
} from '../../../../../../../../lib/musicBackend.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicReplaceEnabled()) return reply({ error: 'music_replace_unavailable' }, 404);
    if (!UUID_RE.test(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicReplaceCommit(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_commit_replace_take', {
            p_auth_id: authId,
            p_song_id: id,
            p_generation_request_id: input.generationId,
            p_version_id: input.versionId,
            p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ version_id: result.version_id, idempotent: result.idempotent === true });
    } catch (error) {
        console.error('[music/replacements/commit] failed:', error?.message);
        return reply({ error: 'take_commit_unknown' }, 503);
    }
}
