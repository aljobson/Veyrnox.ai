import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { validMusicAuthId } from '../../../../../../../lib/musicBackend.js';
import { musicLyricsEnabled, publicLyrics } from '../../../../../../../lib/musicLyrics.js';
import { isUuid } from '../../../../../../../lib/validate.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** The lyrics one of your own songs was made from, or null for an instrumental. */
export async function GET(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicLyricsEnabled()) return reply({ error: 'music_lyrics_unavailable' }, 404);
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_get_song_lyrics', { p_auth_id: authId, p_song_id: id }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        return reply({ lyrics: publicLyrics(result.lyrics) });
    } catch (error) {
        console.error('[music/lyrics] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
