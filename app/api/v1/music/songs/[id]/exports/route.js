import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import {
    musicDistributionEnabled, musicRpcStatus, parseMusicExportStart,
    publicMusicError, readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicDistributionEnabled()) return reply({ error: 'music_distribution_unavailable' }, 404);
    const { id } = await params;
    if (!UUID_RE.test(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicExportStart(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const result = await rpc('music_start_audio_export', {
            p_auth_id: authId, p_quote_id: input.quoteId, p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({
            export: { id: result.export_id, state: result.state },
            allowance: { total: result.allowance, used: result.used, remaining: result.remaining },
            idempotent: result.idempotent === true,
        }, result.idempotent ? 200 : 201);
    } catch (error) {
        console.error('[music/exports] start failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
