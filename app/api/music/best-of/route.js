import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { musicPublicationEnabled } from '../../../../lib/musicBackend.js';
import { musicBestOfEnabled, publicBestOf } from '../../../../lib/musicLyrics.js';

// The read takes no input: a query string is refused rather than ignored.
const QUERY_RE = /^$/;

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Anonymous, read-only "Best of <genre>" playlists for Explore (0535). Published
 * tracks only, public rail fields only; it reads no identity header.
 */
export async function GET(request) {
    if (!musicPublicationEnabled() || !musicBestOfEnabled()) return reply({ error: 'not_found' }, 404);
    if (!QUERY_RE.test(new URL(request.url).search)) return reply({ error: 'not_found' }, 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'not_found' }, 404);
    try {
        const result = await rpc('music_best_of_playlists', {}, cfg);
        if (!result?.ok) return reply({ error: 'temporarily_unavailable' }, 502);
        return reply({ playlists: publicBestOf(result) });
    } catch (error) {
        console.error('[music/best-of] read failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
