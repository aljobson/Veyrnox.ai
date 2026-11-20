import { musicCommentsReadHandler } from '../../../../../lib/musicCommentsRead.js';
import { retryAfterSeconds } from '../../../../../lib/rateLimitHeaders.js';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { musicCommentsEnabled, parseMusicCommentWrite } from '../../../../../lib/musicComments.js';
import { musicPlaysEnabled, musicSongReportsEnabled, parseMusicPlay, parseMusicSongReport } from '../../../../../lib/musicPlays.js';

// Signed-in track comments (0518). Approved comments are also on the anonymous
// public track route; this one adds the caller's own pending comments, paging and the writes.
const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export const GET = musicCommentsReadHandler();

export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const action = decoded.value?.action;
    const parser = action === 'count_play' ? parseMusicPlay : action === 'report_song' ? parseMusicSongReport : parseMusicCommentWrite;
    if (action === 'count_play' && !musicPlaysEnabled()) return reply({ error: 'music_plays_unavailable' }, 404);
    if (action === 'report_song' && !musicSongReportsEnabled()) return reply({ error: 'music_song_reports_unavailable' }, 404);
    if (action !== 'count_play' && action !== 'report_song' && !musicCommentsEnabled()) return reply({ error: 'not_found' }, 404);
    const input = parser(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        if (action === 'count_play') {
            const result = await rpc('music_count_public_play', { p_auth_id: authId, p_slug: input.slug }, cfg);
            if (!result?.ok) return reply({ error: 'not_found' }, 404);
            return reply({ counted: result.counted === true });
        }
        if (action === 'report_song') {
            const result = await rpc('music_report_song', { p_auth_id: authId, p_idempotency_key: input.idempotencyKey, p_payload: input.payload }, cfg);
            if (!result?.ok) {
                if (result?.code === 'SELF_REVIEW') return reply({ error: 'own_song' }, 409);
                const status = musicRpcStatus(result?.code);
                const headers = status === 429 ? { 'Retry-After': String(retryAfterSeconds(result.retry_after_seconds, { max: 86400, fallback: 3600 })) } : {};
                return reply({ error: publicMusicError(result?.code) }, status, headers);
            }
            return reply({ status: 'reported', ...(result.idempotent ? { idempotent: true } : {}) }, result.idempotent ? 200 : 201);
        }
        const result = await rpc('music_comment_mutate', { p_auth_id: authId, p_idempotency_key: input.idempotencyKey, p_payload: input.payload }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ id: result.id, status: result.status, idempotent: result.idempotent === true }, result.idempotent === true ? 200 : 201);
    } catch (error) {
        console.error('[music/comments] write failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
