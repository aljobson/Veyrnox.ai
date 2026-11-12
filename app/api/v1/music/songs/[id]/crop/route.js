import { rpc, envConfig } from '../../../../../../../packages/db/supabase-client.js';
import { deleteObject, envConfig as r2EnvConfig, getObject, isConfigured as r2IsConfigured, putObject, sha256Hex } from '../../../../../../../packages/adapters/r2.js';
import { inspectStoredSource } from '../../../../../../../lib/resolveSource.js';
import { musicEditingEnabled, musicRpcStatus, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../../../lib/musicBackend.js';
import { parseMusicCrop } from '../../../../../../../lib/musicEditing.js';
import { renderPcmWavCrop } from '../../../../../../../lib/musicWavRender.js';

import { isUuid } from '../../../../../../../lib/validate.js';
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request, { params }) {
    const authId=request.headers.get('x-veyrnox-auth-id'); const { id }=await params;
    if (!validMusicAuthId(authId)) return reply({ error:'not_authenticated' },401);
    if (!musicEditingEnabled()) return reply({ error:'music_editing_unavailable' },404);
    if (!isUuid(id||'')) return reply({ error:'song_id_invalid' },400);
    const cfg=envConfig(); const r2cfg=r2EnvConfig();
    if (!cfg.supabaseUrl||!cfg.serviceRoleKey||!r2IsConfigured(r2cfg)) return reply({ error:'gateway_not_configured' },503);
    const decoded=await readMusicJson(request); if (!decoded.ok) return reply({ error:decoded.error },400);
    const input=parseMusicCrop(decoded.value); if (!input.ok) return reply({ error:input.error },400);
    try {
        const context=await rpc('music_get_crop_render_context',{p_auth_id:authId,p_song_id:id,p_version_id:input.versionId,
            p_start_seconds:input.start,p_end_seconds:input.end,p_idempotency_key:input.idempotencyKey},cfg);
        if (!context?.ok) return reply({ error:publicMusicError(context?.code) },musicRpcStatus(context?.code));
        if (context.idempotent) return reply({ version_id:context.version_id,version_number:context.version_number,
            render_state:context.render_state,idempotent:true });
        const inspected=await inspectStoredSource(context.r2_key,{contentType:context.mime_type,field:'audio_url'},r2cfg);
        if (!inspected.ok||!Number.isFinite(inspected.seconds)) return reply({ error:'source_duration_unavailable' },400);
        if (input.end>inspected.seconds+0.05) return reply({ error:'crop_range_invalid',duration_seconds:inspected.seconds },400);
        if (context.mime_type==='audio/wav' && Number(context.size_bytes)<=26214400) {
            const stored=await getObject(context.r2_key,r2cfg);
            if (!stored.ok) return reply({ error:'source_unavailable' },502);
            const source=new Uint8Array(await stored.response.arrayBuffer());
            if (source.length!==Number(context.size_bytes)) return reply({ error:'source_changed' },409);
            const rendered=renderPcmWavCrop(source,input.start,input.end);
            if (rendered.ok) {
                const outputVersionId=crypto.randomUUID(); const outputJobId=crypto.randomUUID(); const outputAssetId=crypto.randomUUID();
                const outputKey=`music-renders/${context.user_id}/${outputVersionId}.wav`;
                const hash=await sha256Hex(rendered.bytes);
                const uploaded=await putObject(outputKey,rendered.bytes,'audio/wav',r2cfg);
                if (!uploaded.ok) return reply({ error:'render_storage_failed' },502);
                const result=await rpc('music_commit_rendered_wav_crop',{p_auth_id:authId,p_song_id:id,
                    p_source_version_id:input.versionId,p_output_version_id:outputVersionId,p_output_job_id:outputJobId,
                    p_output_asset_id:outputAssetId,p_r2_key:outputKey,p_size_bytes:rendered.bytes.length,p_sha256:hash,
                    p_start_seconds:input.start,p_end_seconds:input.end,p_source_duration:inspected.seconds,
                    p_output_duration:rendered.seconds,p_idempotency_key:input.idempotencyKey},cfg);
                if (!result?.ok) {
                    await deleteObject(outputKey,r2cfg);
                    return reply({ error:publicMusicError(result?.code) },musicRpcStatus(result?.code));
                }
                if (result.idempotent===true && result.r2_key!==outputKey) await deleteObject(outputKey,r2cfg);
                return reply({ version_id:result.version_id,version_number:result.version_number,
                    render_state:'canonical',format:'wav',idempotent:result.idempotent===true },result.idempotent?200:201);
            }
        }
        const result=await rpc('music_crop_song',{p_auth_id:authId,p_song_id:id,p_source_version_id:input.versionId,
            p_output_version_id:crypto.randomUUID(),p_start_seconds:input.start,p_end_seconds:input.end,
            p_source_duration:inspected.seconds,p_idempotency_key:input.idempotencyKey},cfg);
        if (!result?.ok) return reply({ error:publicMusicError(result?.code) },musicRpcStatus(result?.code));
        return reply({ version_id:result.version_id,version_number:result.version_number,
            render_state:'preview_only',idempotent:result.idempotent===true },result.idempotent?200:201);
    } catch(error){ console.error('[music/crop] failed:',error?.message); return reply({ error:'temporarily_unavailable' },502); }
}
