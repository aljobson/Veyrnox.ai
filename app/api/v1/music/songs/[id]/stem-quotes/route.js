import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../../../../packages/adapters/r2.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import {
    musicRpcStatus, musicStemsEnabled, parseMusicStemQuote, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
});

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicStemsEnabled()) return reply({ error: 'music_stems_unavailable' }, 404);
    if (!UUID_RE.test(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicStemQuote(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig(); const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return reply({ error: 'gateway_not_configured' }, 503);
    }
    try {
        const source = await rpc('music_get_stem_source_context', {
            p_auth_id: authId, p_song_id: id, p_version_id: input.versionId,
        }, cfg);
        if (!source?.ok) return reply({ error: publicMusicError(source?.code) }, musicRpcStatus(source?.code));
        const inspected = await inspectStoredSource(source.r2_key, {
            contentType: 'audio/mpeg', field: 'audio_url',
        }, r2cfg);
        if (!inspected.ok) return reply({ error: 'source_unavailable' }, 400);
        const result = await rpc('music_create_stem_quote', {
            p_auth_id: authId, p_song_id: id, p_version_id: input.versionId,
            p_rights_confirmed: input.rightsConfirmed,
        }, cfg);
        if (!result?.ok) {
            const status = musicRpcStatus(result?.code);
            const headers = status === 429 ? { 'Retry-After': String(result.retry_after_seconds || 60) } : {};
            return reply({ error: publicMusicError(result?.code) }, status, headers);
        }
        return reply({
            quote_id: result.quote_id, model_id: result.model_id,
            total_credits: result.total_credits, balance: result.balance,
            balance_after: result.balance_after, affordable: result.affordable,
            expires_at: result.expires_at, outputs: result.outputs,
        }, 201);
    } catch (error) {
        console.error('[music/stem-quotes] failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
