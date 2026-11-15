import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { readMusicJson, validMusicAuthId } from '../../../../../lib/musicBackend.js';
import { musicPlaysEnabled, parseMusicPlay } from '../../../../../lib/musicPlays.js';

const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Count one signed-in play of a published track. The response never says who else played. */
export async function POST(request) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicPlaysEnabled()) return reply({ error: 'music_plays_unavailable' }, 404);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicPlay(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_count_public_play', { p_auth_id: authId, p_slug: input.slug }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        return reply({ counted: result.counted === true });
    } catch (error) {
        console.error('[music/plays] count failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
