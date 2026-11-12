import { retryAfterSeconds } from '../../../../../../../lib/rateLimitHeaders.js';
import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../../../../packages/adapters/r2.js';
import { publishFalDispatchWakeup } from '../../../../../../../lib/falDispatchWakeup.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import {
    musicCoverEnabled, musicRpcStatus, parseMusicGeneration, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';

import { isUuid } from '../../../../../../../lib/validate.js';
const reply = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
});

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicCoverEnabled()) return reply({ error: 'music_cover_unavailable' }, 404);
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicGeneration(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return reply({ error: 'gateway_not_configured' }, 503);
    }
    try {
        const context = await rpc('music_get_cover_dispatch_context', {
            p_auth_id: authId, p_song_id: id, p_quote_id: input.quoteId,
            p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!context?.ok) return reply({ error: publicMusicError(context?.code) }, musicRpcStatus(context?.code));
        if (context.idempotent) return reply({
            generation_id: context.request_id,
            state: context.state,
            candidates: (context.job_ids || []).map((jobId, index) => ({
                ordinal: index + 1, label: index === 0 ? 'A' : 'B', job_id: jobId, state: context.state,
            })),
            balance_after: context.balance_after,
            idempotent: true,
        });
        const inspected = await inspectStoredSource(context.r2_key, {
            contentType: context.mime_type, field: 'audio_url',
        }, r2cfg);
        if (!inspected.ok || !Number.isFinite(inspected.seconds)) return reply({ error: 'source_duration_unavailable' }, 400);
        if (Math.abs(inspected.seconds - Number(context.source_duration_seconds)) > 0.1) {
            return reply({ error: 'source_changed' }, 409);
        }
        const result = await rpc('music_submit_cover_pair', {
            p_auth_id: authId,
            p_song_id: id,
            p_quote_id: input.quoteId,
            p_idempotency_key: input.idempotencyKey,
            p_source_audio_url: inspected.url,
        }, cfg);
        if (!result?.ok) {
            const status = musicRpcStatus(result?.code);
            const headers = status === 429 || status === 503
                ? { 'Retry-After': String(retryAfterSeconds(result.retry_after_seconds, { max: 600, fallback: 60 })) }
                : {};
            return reply({ error: publicMusicError(result?.code) }, status, headers);
        }
        for (const jobId of result.job_ids || []) {
            try { publishFalDispatchWakeup(jobId); }
            catch { console.error('[music/covers] dispatch wakeup unavailable:', jobId); }
        }
        return reply({
            generation_id: result.request_id,
            state: result.state,
            candidates: (result.job_ids || []).map((jobId, index) => ({
                ordinal: index + 1, label: index === 0 ? 'A' : 'B', job_id: jobId, state: 'queued',
            })),
            balance_after: result.balance_after,
            ...(result.idempotent ? { idempotent: true } : {}),
        }, result.idempotent ? 200 : 202);
    } catch (error) {
        console.error('[music/covers] admission failed:', error?.message);
        return reply({ error: 'pair_acceptance_unknown' }, 503);
    }
}
