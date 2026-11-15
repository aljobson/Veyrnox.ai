import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { readMusicJson, validMusicAuthId } from '../../../../../../../lib/musicBackend.js';
import { musicLibraryTabsEnabled, parseMusicCoverChoice } from '../../../../../../../lib/musicLibraryTabs.js';
import { isUuid } from '../../../../../../../lib/validate.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function PUT(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicLibraryTabsEnabled()) return reply({ error: 'music_library_tabs_unavailable' }, 404);
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicCoverChoice(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_set_song_cover', { p_auth_id: authId, p_song_id: id, p_job_id: input.jobId }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        return reply({ cover_url: result.cover || null });
    } catch (error) {
        console.error('[music/cover] set failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
