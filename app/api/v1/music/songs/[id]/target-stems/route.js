import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { envConfig as r2EnvConfig, isConfigured as r2IsConfigured } from '../../../../../../../packages/adapters/r2.js';
import { publishFalDispatchWakeup } from '../../../../../../../lib/falDispatchWakeup.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import {
    musicRpcStatus, musicTargetStemsEnabled, parseMusicGeneration, publicMusicError,
    readMusicJson, validMusicAuthId,
} from '../../../../../../../lib/musicBackend.js';

import { isUuid } from '../../../../../../../lib/validate.js';
const reply = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
});

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id'); const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicTargetStemsEnabled()) return reply({ error: 'music_target_stems_unavailable' }, 404);
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicGeneration(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig(); const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return reply({ error: 'gateway_not_configured' }, 503);
    }
    try {
        const context = await rpc('music_get_target_stem_dispatch_context', {
            p_auth_id: authId, p_song_id: id, p_quote_id: input.quoteId,
            p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!context?.ok) return reply({ error: publicMusicError(context?.code) }, musicRpcStatus(context?.code));
        if (context.idempotent) return reply({
            request_id: context.request_id, job_id: context.job_id, state: context.state,
            idempotent: true,
        });
        const inspected = await inspectStoredSource(context.r2_key, {
            contentType: context.mime_type, field: 'audio_url',
        }, r2cfg);
        if (!inspected.ok || Math.abs(Number(inspected.seconds) - Number(context.source_duration_seconds)) > 0.05) {
            return reply({ error: 'revision_conflict' }, 409);
        }
        const result = await rpc('music_submit_target_stem_request', {
            p_auth_id: authId, p_song_id: id, p_quote_id: input.quoteId,
            p_idempotency_key: input.idempotencyKey, p_source_audio_url: inspected.url,
        }, cfg);
        if (!result?.ok) {
            const status = musicRpcStatus(result?.code);
            return reply({ error: publicMusicError(result?.code) }, status,
                status === 429 || status === 503 ? { 'Retry-After': String(result.retry_after_seconds || 60) } : {});
        }
        try { publishFalDispatchWakeup(result.job_id); }
        catch { console.error('[music/target-stems] dispatch wakeup unavailable:', result.job_id); }
        return reply({ request_id: result.request_id, job_id: result.job_id,
            state: result.state, balance_after: result.balance_after,
            ...(result.idempotent ? { idempotent: true } : {}) }, result.idempotent ? 200 : 202);
    } catch (error) {
        console.error('[music/target-stems] admission failed:', error?.message);
        return reply({ error: 'target_stem_acceptance_unknown' }, 503);
    }
}
