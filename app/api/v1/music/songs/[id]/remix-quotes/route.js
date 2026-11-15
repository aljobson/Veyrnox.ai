import { retryAfterSeconds } from '../../../../../../../lib/rateLimitHeaders.js';
import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../../../../packages/adapters/r2.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import { musicPromptPolicy, musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../../../lib/musicBackend.js';
import {
    MUSIC_MASHUP_SECONDS_MIN, mashupSeconds, musicRemixEnabled, parseMusicRemixQuote,
} from '../../../../../../../lib/musicRemix.js';
import { isUuid } from '../../../../../../../lib/validate.js';

const reply = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
});

async function measure(source, r2cfg) {
    const inspected = await inspectStoredSource(source.r2_key, { contentType: source.mime_type, field: 'audio_url' }, r2cfg);
    return inspected.ok && Number.isFinite(inspected.seconds) ? inspected.seconds : NaN;
}

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicRemixEnabled()) return reply({ error: 'music_remix_unavailable' }, 404);
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);

    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicRemixQuote(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    if (input.kind === 'mashup' && input.secondSongId.toLowerCase() === id.toLowerCase()) {
        return reply({ error: 'second_song_invalid' }, 400);
    }
    const policy = musicPromptPolicy(input.prompt);
    if (!policy.ok) return reply({ error: policy.error }, 422);

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return reply({ error: 'gateway_not_configured' }, 503);
    }
    try {
        const context = await rpc('music_get_remix_source_context', {
            p_auth_id: authId, p_song_id: id, p_version_id: input.versionId,
            p_second_song_id: input.kind === 'mashup' ? input.secondSongId : null,
            p_second_version_id: input.kind === 'mashup' ? input.secondVersionId : null,
        }, cfg);
        if (!context?.ok) return reply({ error: publicMusicError(context?.code) }, musicRpcStatus(context?.code));
        const seconds = await Promise.all((context.sources || []).map((source) => measure(source, r2cfg)));
        if (!seconds.length || seconds.some((value) => !Number.isFinite(value))) {
            return reply({ error: 'source_duration_unavailable' }, 400);
        }
        let duration = seconds[0];
        if (input.kind === 'mashup') {
            duration = mashupSeconds(seconds[0], seconds[1]);
            if (!(duration >= MUSIC_MASHUP_SECONDS_MIN)) return reply({ error: 'source_duration_invalid' }, 400);
        } else if (input.endSeconds > seconds[0]) {
            return reply({ error: 'sample_range_invalid', duration_seconds: seconds[0] }, 400);
        }
        const result = await rpc('music_create_remix_quote', {
            p_auth_id: authId,
            p_kind: input.kind,
            p_song_id: id,
            p_version_id: input.versionId,
            p_second_song_id: input.kind === 'mashup' ? input.secondSongId : null,
            p_second_version_id: input.kind === 'mashup' ? input.secondVersionId : null,
            p_prompt: input.prompt,
            p_source_influence: input.kind === 'mashup' ? input.sourceInfluence : null,
            p_sample_start: input.kind === 'sample' ? input.startSeconds : null,
            p_sample_end: input.kind === 'sample' ? input.endSeconds : null,
            p_sample_extend: input.kind === 'sample' ? input.extendSeconds : null,
            p_rights_confirmed: input.rightsConfirmed,
            p_source_duration_seconds: duration,
        }, cfg);
        if (!result?.ok) {
            const status = musicRpcStatus(result?.code);
            const headers = status === 429
                ? { 'Retry-After': String(retryAfterSeconds(result.retry_after_seconds, { max: 600, fallback: 60 })) }
                : {};
            return reply({ error: publicMusicError(result?.code) }, status, headers);
        }
        return reply({
            quote_id: result.quote_id,
            kind: result.kind,
            model_id: result.model_id,
            output_count: 2,
            credits_per_candidate: result.unit_credits,
            total_credits: result.total_credits,
            balance: result.balance,
            balance_after: result.balance_after,
            affordable: result.affordable,
            expires_at: result.expires_at,
            source_duration_seconds: result.source_duration_seconds,
            policy_version: policy.version,
        }, 201);
    } catch (error) {
        console.error('[music/remix-quotes] failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
