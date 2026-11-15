import { retryAfterSeconds } from '../../../../../lib/rateLimitHeaders.js';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { musicSongReportsEnabled, parseMusicSongReport } from '../../../../../lib/musicPlays.js';

const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

/** Report someone else's published track to the administrator queue (0524). */
export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicSongReportsEnabled()) return reply({ error: 'music_song_reports_unavailable' }, 404);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicSongReport(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_report_song', { p_auth_id: authId, p_idempotency_key: input.idempotencyKey, p_payload: input.payload }, cfg);
        if (!result?.ok) {
            if (result?.code === 'SELF_REVIEW') return reply({ error: 'own_song' }, 409);
            const status = musicRpcStatus(result?.code);
            const headers = status === 429 ? { 'Retry-After': String(retryAfterSeconds(result.retry_after_seconds, { max: 86400, fallback: 3600 })) } : {};
            return reply({ error: publicMusicError(result?.code) }, status, headers);
        }
        return reply({ status: 'reported', ...(result.idempotent ? { idempotent: true } : {}) }, result.idempotent ? 200 : 201);
    } catch (error) {
        console.error('[music/song-reports] report failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
