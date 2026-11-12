import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../../../../packages/adapters/r2.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import {
    MUSIC_REPLACE_DURATION_MAX, musicPromptPolicy, musicReplaceEnabled, musicRpcStatus,
    parseMusicReplaceQuote, publicMusicError, readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';

import { isUuid } from '../../../../../../../lib/validate.js';
const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id'); const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicReplaceEnabled()) return reply({ error: 'music_replace_unavailable' }, 404);
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicReplaceQuote(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const policy = musicPromptPolicy(input.prompt);
    if (!policy.ok) return reply({ error: policy.error }, 422);
    const cfg = envConfig(); const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const source = await rpc('music_get_replace_source_context', { p_auth_id: authId, p_song_id: id, p_version_id: input.versionId }, cfg);
        if (!source?.ok) return reply({ error: publicMusicError(source?.code) }, musicRpcStatus(source?.code));
        const inspected = await inspectStoredSource(source.r2_key, { contentType: source.mime_type, field: 'audio_url' }, r2cfg);
        if (!inspected.ok || !Number.isFinite(inspected.seconds)) return reply({ error: 'source_duration_unavailable' }, 400);
        if (inspected.seconds < 1 || inspected.seconds > MUSIC_REPLACE_DURATION_MAX || input.endSeconds > inspected.seconds) {
            return reply({ error: 'range_invalid', source_duration_seconds: inspected.seconds }, 400);
        }
        const result = await rpc('music_create_replace_quote', {
            p_auth_id: authId, p_song_id: id, p_version_id: input.versionId, p_prompt: input.prompt,
            p_start_seconds: input.startSeconds, p_end_seconds: input.endSeconds,
            p_rights_confirmed: input.rightsConfirmed, p_source_duration_seconds: inspected.seconds,
        }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({
            quote_id: result.quote_id, model_id: result.model_id, output_count: 2,
            credits_per_candidate: result.unit_credits, total_credits: result.total_credits,
            balance: result.balance, balance_after: result.balance_after, affordable: result.affordable,
            expires_at: result.expires_at, source_duration_seconds: result.source_duration_seconds,
            start_seconds: result.start_seconds, end_seconds: result.end_seconds, policy_version: policy.version,
        }, 201);
    } catch (error) {
        console.error('[music/replace-quotes] failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
