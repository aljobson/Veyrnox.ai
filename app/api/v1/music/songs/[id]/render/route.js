import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { deleteObject, envConfig as r2EnvConfig, getObject, isConfigured as r2IsConfigured, putObject, sha256Hex } from '../../../../../../../packages/adapters/r2.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import { musicEditingEnabled, musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../../../lib/musicBackend.js';
import { parseMusicLocalRender } from '../../../../../../../lib/musicEditing.js';
import { renderPcmWavFade, renderPcmWavRemaster, renderPcmWavReorder, renderPcmWavSpeed } from '../../../../../../../lib/musicWavRender.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicEditingEnabled()) return reply({ error: 'music_editing_unavailable' }, 404);
    if (!UUID_RE.test(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) return reply({ error: 'gateway_not_configured' }, 503);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicLocalRender(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    try {
        const context = await rpc(input.operation === 'reorder' ? 'music_get_reorder_render_context' : 'music_get_local_render_context', {
            p_auth_id: authId, p_song_id: id, p_version_id: input.versionId,
            p_operation: input.operation, p_parameters: input.parameters,
            p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!context?.ok) return reply({ error: publicMusicError(context?.code) }, musicRpcStatus(context?.code));
        if (context.idempotent) return reply({
            version_id: context.version_id, version_number: context.version_number,
            operation: input.operation, render_state: context.render_state, idempotent: true,
        });
        if (context.mime_type !== 'audio/wav' || Number(context.size_bytes) > 26_214_400) {
            return reply({ error: 'render_format_unsupported' }, 400);
        }
        const inspected = await inspectStoredSource(context.r2_key, { contentType: context.mime_type, field: 'audio_url' }, r2cfg);
        if (!inspected.ok || !Number.isFinite(inspected.seconds)) return reply({ error: 'source_duration_unavailable' }, 400);
        if (input.operation === 'fade'
            && input.parameters.fade_in_seconds + input.parameters.fade_out_seconds > inspected.seconds) {
            return reply({ error: 'fade_range_invalid', duration_seconds: inspected.seconds }, 400);
        }
        if (input.operation === 'reorder'
            && input.parameters.split_seconds > inspected.seconds - 1) {
            return reply({ error: 'reorder_range_invalid', duration_seconds: inspected.seconds }, 400);
        }
        const stored = await getObject(context.r2_key, r2cfg);
        if (!stored.ok) return reply({ error: 'source_unavailable' }, 502);
        const source = new Uint8Array(await stored.response.arrayBuffer());
        if (source.length !== Number(context.size_bytes)) return reply({ error: 'source_changed' }, 409);
        const rendered = input.operation === 'fade'
            ? renderPcmWavFade(source, input.parameters.fade_in_seconds, input.parameters.fade_out_seconds)
            : input.operation === 'speed'
                ? renderPcmWavSpeed(source, input.parameters.speed_ratio)
                : input.operation === 'reorder'
                    ? renderPcmWavReorder(source, input.parameters.split_seconds, input.parameters.order)
                    : renderPcmWavRemaster(source, input.parameters.target_peak_dbfs);
        if (!rendered.ok) return reply({ error: rendered.error }, 400);

        const outputVersionId = crypto.randomUUID();
        const outputJobId = crypto.randomUUID();
        const outputAssetId = crypto.randomUUID();
        const outputKey = `music-renders/${context.user_id}/${outputVersionId}.wav`;
        const hash = await sha256Hex(rendered.bytes);
        const uploaded = await putObject(outputKey, rendered.bytes, 'audio/wav', r2cfg);
        if (!uploaded.ok) return reply({ error: 'render_storage_failed' }, 502);
        const result = await rpc(input.operation === 'reorder' ? 'music_commit_reordered_wav' : 'music_commit_local_wav_render', {
            p_auth_id: authId, p_song_id: id, p_source_version_id: input.versionId,
            p_output_version_id: outputVersionId, p_output_job_id: outputJobId,
            p_output_asset_id: outputAssetId, p_r2_key: outputKey,
            p_size_bytes: rendered.bytes.length, p_sha256: hash,
            p_operation: input.operation, p_parameters: input.parameters,
            p_source_duration: inspected.seconds, p_output_duration: rendered.seconds,
            p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!result?.ok) {
            await deleteObject(outputKey, r2cfg);
            return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        }
        if (result.idempotent === true && result.r2_key !== outputKey) await deleteObject(outputKey, r2cfg);
        return reply({
            version_id: result.version_id, version_number: result.version_number,
            operation: input.operation, render_state: 'canonical', format: 'wav',
            duration_seconds: rendered.seconds, idempotent: result.idempotent === true,
        }, result.idempotent ? 200 : 201);
    } catch (error) {
        // An ambiguous commit may already reference the uploaded object. Leave
        // it intact so the same idempotency key can reconcile on retry.
        console.error('[music/local-render] failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}
