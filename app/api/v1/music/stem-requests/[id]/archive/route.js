import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured, presignGetUrl } from '../../../../../../../packages/adapters/r2.js';
import { musicStemsEnabled, validMusicAuthId } from '../../../../../../../lib/musicBackend.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id'); const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicStemsEnabled()) return reply({ error: 'music_stems_unavailable' }, 404);
    if (!UUID_RE.test(id || '')) return reply({ error: 'request_id_invalid' }, 400);
    const cfg = envConfig(); const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const context = await rpc('music_get_stem_archive_context', {
            p_auth_id: authId, p_request_id: id,
        }, cfg);
        if (!context?.ok) return reply({ error: 'not_found' }, 404);
        const signed = await presignGetUrl(context.r2_key, 300, r2cfg, {
            downloadFilename: `veyrnox-stems-${String(context.song_id).slice(0, 8)}.zip`,
        });
        return reply({ url: signed.url, mime_type: 'application/zip',
            size_bytes: context.size_bytes, expires_in: signed.expires });
    } catch (error) {
        console.error('[music/stem-archive] failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
