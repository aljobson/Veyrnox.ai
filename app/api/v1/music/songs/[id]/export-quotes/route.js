import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import {
    musicDistributionEnabled, musicRpcStatus, parseMusicExportQuote,
    publicMusicError, readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';

import { isUuid } from '../../../../../../../lib/validate.js';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicDistributionEnabled()) return reply({ error: 'music_distribution_unavailable' }, 404);
    const { id } = await params;
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicExportQuote(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const exportability = await rpc('music_get_version_exportability', {
            p_auth_id: authId, p_song_id: id, p_version_id: input.versionId,
        }, cfg);
        if (!exportability?.ok) return reply({ error: 'not_found' }, 404);
        if (!exportability.rendered) return reply({ error: 'render_required' }, 409);
        const result = await rpc('music_quote_audio_export', {
            p_auth_id: authId, p_song_id: id, p_version_id: input.versionId, p_format: input.format,
        }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ quote: result.quote }, 201);
    } catch (error) {
        console.error('[music/export-quotes] create failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
