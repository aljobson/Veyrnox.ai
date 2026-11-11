import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured, presignGetUrl } from '../../../../../../../packages/adapters/r2.js';
import { musicTargetStemsEnabled, validMusicAuthId } from '../../../../../../../lib/musicBackend.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id'); const { id, kind } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicTargetStemsEnabled()) return reply({ error: 'music_target_stems_unavailable' }, 404);
    if (!UUID_RE.test(id || '') || !['target', 'residual'].includes(kind)) return reply({ error: 'request_invalid' }, 400);
    const cfg = envConfig(); const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const context = await rpc('music_get_target_stem_asset_context', {
            p_auth_id: authId, p_request_id: id, p_kind: kind,
        }, cfg);
        if (!context?.ok) return reply({ error: 'not_found' }, 404);
        const label = kind === 'target' ? context.instrument : `without-${context.instrument}`;
        const signed = await presignGetUrl(context.r2_key, 300, r2cfg, {
            downloadFilename: `veyrnox-${label}-${String(context.song_id).slice(0, 8)}.wav`,
        });
        return reply({ url: signed.url, mime_type: context.mime_type,
            size_bytes: context.size_bytes, expires_in: signed.expires, kind });
    } catch (error) {
        console.error('[music/target-stem-asset] failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
