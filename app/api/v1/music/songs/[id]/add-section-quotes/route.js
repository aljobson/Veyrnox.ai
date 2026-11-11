import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../../../../packages/adapters/r2.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import {
    MUSIC_ADD_SECTION_SOURCE_MAX, musicAddSectionEnabled, musicPromptPolicy,
    musicRpcStatus, parseMusicAddSectionQuote, publicMusicError, readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
});

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicAddSectionEnabled()) return reply({ error: 'music_add_section_unavailable' }, 404);
    if (!UUID_RE.test(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicAddSectionQuote(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const policy = musicPromptPolicy(`${input.styles}\n${input.lyrics || ''}`);
    if (!policy.ok) return reply({ error: policy.error }, 422);

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const source = await rpc('music_get_add_section_source_context', {
            p_auth_id: authId, p_song_id: id, p_version_id: input.versionId,
        }, cfg);
        if (!source?.ok) return reply({ error: publicMusicError(source?.code) }, musicRpcStatus(source?.code));
        const inspected = await inspectStoredSource(source.r2_key, { contentType: source.mime_type, field: 'audio_url' }, r2cfg);
        if (!inspected.ok || !Number.isFinite(inspected.seconds)) return reply({ error: 'source_duration_unavailable' }, 400);
        if (inspected.seconds < 1 || inspected.seconds > MUSIC_ADD_SECTION_SOURCE_MAX) {
            return reply({ error: 'source_duration_invalid', max_duration_seconds: MUSIC_ADD_SECTION_SOURCE_MAX }, 400);
        }
        const result = await rpc('music_create_add_section_quote', {
            p_auth_id: authId, p_song_id: id, p_version_id: input.versionId,
            p_position: input.position, p_duration_seconds: input.durationSeconds,
            p_lyrics: input.lyrics, p_styles: input.styles,
            p_rights_confirmed: input.rightsConfirmed, p_source_duration_seconds: inspected.seconds,
        }, cfg);
        if (!result?.ok) {
            const status = musicRpcStatus(result?.code);
            const headers = status === 429 ? { 'Retry-After': String(Math.max(1, Math.min(600, Number(result.retry_after_seconds) || 60))) } : {};
            return reply({ error: publicMusicError(result?.code) }, status, headers);
        }
        return reply({
            quote_id: result.quote_id, model_id: result.model_id, output_count: 2,
            credits_per_candidate: result.unit_credits, total_credits: result.total_credits,
            balance: result.balance, balance_after: result.balance_after, affordable: result.affordable,
            expires_at: result.expires_at, source_duration_seconds: result.source_duration_seconds,
            position: result.position, duration_seconds: result.duration_seconds,
            instrumental: input.lyrics === null, policy_version: policy.version,
        }, 201);
    } catch (error) {
        console.error('[music/add-section-quotes] failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
