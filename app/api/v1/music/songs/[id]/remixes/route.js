import { retryAfterSeconds } from '../../../../../../../lib/rateLimitHeaders.js';
import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import {
    deleteObject, envConfig as r2EnvConfig, getObject, isConfigured as r2IsConfigured, putObject,
} from '../../../../../../../packages/adapters/r2.js';
import { publishFalDispatchWakeup } from '../../../../../../../lib/falDispatchWakeup.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import { musicRpcStatus, parseMusicGeneration, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../../../lib/musicBackend.js';
import { MUSIC_MASHUP_SECONDS_MAX, musicRemixEnabled, remixSourceKey } from '../../../../../../../lib/musicRemix.js';
import { renderPcmWavCrop, renderPcmWavMix } from '../../../../../../../lib/musicWavRender.js';
import { isUuid } from '../../../../../../../lib/validate.js';

const MAX_SOURCE_BYTES = 26_214_400;
const reply = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
});

function candidates(jobIds, state) {
    return (jobIds || []).map((jobId, index) => ({
        ordinal: index + 1, label: index === 0 ? 'A' : 'B', job_id: jobId, state,
    }));
}

async function readSource(source, r2cfg) {
    if (source.mime_type !== 'audio/wav' || Number(source.size_bytes) > MAX_SOURCE_BYTES) return null;
    const stored = await getObject(source.r2_key, r2cfg);
    if (!stored.ok) return null;
    const bytes = new Uint8Array(await stored.response.arrayBuffer());
    return bytes.length === Number(source.size_bytes) ? bytes : null;
}

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicRemixEnabled()) return reply({ error: 'music_remix_unavailable' }, 404);
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
    let preparedKey = null;
    try {
        const context = await rpc('music_get_remix_dispatch_context', {
            p_auth_id: authId, p_song_id: id, p_quote_id: input.quoteId, p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!context?.ok) return reply({ error: publicMusicError(context?.code) }, musicRpcStatus(context?.code));
        if (context.idempotent) return reply({
            generation_id: context.request_id, state: context.state,
            candidates: candidates(context.job_ids, context.state),
            balance_after: context.balance_after, idempotent: true,
        });
        const sources = await Promise.all((context.sources || []).map((source) => readSource(source, r2cfg)));
        if (!sources.length || sources.some((bytes) => !bytes)) return reply({ error: 'source_unavailable' }, 409);
        const rendered = context.kind === 'mashup'
            ? renderPcmWavMix(sources[0], sources[1], MUSIC_MASHUP_SECONDS_MAX)
            : renderPcmWavCrop(sources[0], Number(context.sample_start_seconds), Number(context.sample_end_seconds));
        if (!rendered.ok) return reply({ error: rendered.error }, 400);
        if (Math.abs(rendered.seconds - Number(context.source_duration_seconds)) > 0.1) {
            return reply({ error: 'source_changed' }, 409);
        }
        preparedKey = remixSourceKey(context.user_id);
        const uploaded = await putObject(preparedKey, rendered.bytes, 'audio/wav', r2cfg);
        if (!uploaded.ok) { preparedKey = null; return reply({ error: 'render_storage_failed' }, 502); }
        const signed = await inspectStoredSource(preparedKey, { contentType: 'audio/wav', field: 'audio_url' }, r2cfg);
        if (!signed.ok || !signed.url) {
            await deleteObject(preparedKey, r2cfg);
            return reply({ error: 'source_duration_unavailable' }, 502);
        }
        const result = await rpc('music_submit_remix_pair', {
            p_auth_id: authId, p_song_id: id, p_quote_id: input.quoteId,
            p_idempotency_key: input.idempotencyKey, p_prepared_r2_key: preparedKey,
            p_prepared_audio_url: signed.url, p_prepared_seconds: rendered.seconds,
        }, cfg);
        if (!result?.ok || result.idempotent) await deleteObject(preparedKey, r2cfg);
        if (!result?.ok) {
            const status = result?.code === 'SOURCE_CHANGED' ? 409 : musicRpcStatus(result?.code);
            const headers = status === 429 || status === 503
                ? { 'Retry-After': String(retryAfterSeconds(result?.retry_after_seconds, { max: 600, fallback: 60 })) }
                : {};
            return reply({ error: publicMusicError(result?.code) }, status, headers);
        }
        for (const jobId of result.job_ids || []) {
            try { publishFalDispatchWakeup(jobId); }
            catch { console.error('[music/remixes] dispatch wakeup unavailable:', jobId); }
        }
        return reply({
            generation_id: result.request_id, state: result.state,
            candidates: candidates(result.job_ids, 'queued'),
            balance_after: result.balance_after,
            ...(result.idempotent ? { idempotent: true } : {}),
        }, result.idempotent ? 200 : 202);
    } catch (error) {
        console.error('[music/remixes] admission failed:', error?.message);
        return reply({ error: 'pair_acceptance_unknown' }, 503);
    }
}
