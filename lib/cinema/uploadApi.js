import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';
import { streamConfig, createStreamUpload, readStreamVideo, mediaObservation, validUploadUrl } from './stream.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const errors={upload_not_allowed:403,invalid_upload:400,idempotency_conflict:409,upload_exists:409,upload_removed:409,upload_needs_reconciliation:409,upload_capacity_reached:429};
export function uploadProjection(row) {
  if(!row) return null;
  const expired=Date.parse(row.expires_at)<=Date.now();
  return {id:row.id,content_id:row.content_id,state:row.state==='uploading'&&expired?'expired':row.state,
    file_size:row.file_size,fingerprint:row.fingerprint,expires_at:row.expires_at,
    upload_url:row.state==='uploading'&&!expired&&validUploadUrl(row.upload_url)?row.upload_url:null,
    duration_seconds:row.duration_seconds,width:row.width,height:row.height};
}
export function uploadHandler({action='read',rpcCall=rpc,createVideo=createStreamUpload,readVideo=readStreamVideo}={}) {
  return async req=>{
    const id=crypto.randomUUID(),auth=req.headers.get('x-veyrnox-auth-id');
    const reply=(body,status=200)=>{
      console.info(JSON.stringify({event:'cinema.upload',request_id:id,actor_id:UUID.test(auth||'')?auth:undefined,action,status,code:body.error||'ok'}));
      return Response.json({...body,request_id:id},{status,headers:{'Cache-Control':'no-store','x-request-id':id,...(status===429?{'Retry-After':'60'}:{})}});
    };
    if(!UUID.test(auth||'')) return reply({error:'not_authenticated'},401);
    const flags=cinemaFeatures(process.env);
    if(action==='remove' ? process.env.CINEMA_UPLOAD_REMOVAL_ENABLED!=='true' : !flags.content||!flags.uploads) return reply({error:'uploads_not_open'},503);
    try {
      const cfg=streamConfig(),db=envConfig(),query=new URL(req.url).searchParams;
      let body;
      if(action==='read') {
        if([...query.keys()].some(k=>k!=='content_id')||query.getAll('content_id').length!==1) return reply({error:'invalid_upload'},400);
        body={content_id:query.get('content_id')};
      } else {
        if(query.size) return reply({error:'invalid_upload'},400);
        if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json') return reply({error:'invalid_content_type'},415);
        const limited=await limitRequestBody(req);if(limited.response) return reply({error:'invalid_body'},limited.response.status);
        try { body=await limited.request.json(); } catch { return reply({error:'invalid_body'},400); }
      }
      const allowed=action==='start'?['content_id','file_size','fingerprint']:action==='remove'?['content_id','upload_id']:['content_id'];
      if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!allowed.includes(k))||typeof body.content_id!=='string'||!UUID.test(body.content_id)) return reply({error:'invalid_upload'},400);
      const key=req.headers.get('idempotency-key');
      if(action!=='read'&&!UUID.test(key||'')) return reply({error:'invalid_idempotency_key'},400);
      if(action==='remove'&&(typeof body.upload_id!=='string'||!UUID.test(body.upload_id))) return reply({error:'invalid_upload'},400);
      if(action==='start'&&(!Number.isSafeInteger(body.file_size)||body.file_size<1||body.file_size>2147483648||typeof body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.fingerprint))) return reply({error:'invalid_upload'},400);
      const rate=await rpcCall('consume_account_read_request',{p_auth_id:auth},db);
      if(rate?.code==='RATE_LIMITED') return reply({error:'rate_limited'},429);
      if(rate?.ok!==true) return reply({error:'temporarily_unavailable'},503);
      const ownerArgs={p_auth_id:auth,p_content_id:body.content_id};
      if(action==='remove') {
        const removal=await rpcCall('request_cinema_upload_removal',{...ownerArgs,p_upload_id:body.upload_id,p_key:key},db);
        if(removal?.ok!==true) return reply({error:Object.hasOwn(errors,removal?.error)?removal.error:'temporarily_unavailable'},errors[removal?.error]||503);
        const current=await rpcCall('read_cinema_upload',ownerArgs,db);
        if(current?.error) return reply({error:'upload_not_allowed'},403);
        if(!current||!Object.hasOwn(current,'upload')) return reply({error:'temporarily_unavailable'},503);
        return reply({upload:uploadProjection(current.upload)},202);
      }
      let result=action==='start'?await rpcCall('reserve_cinema_upload',{...ownerArgs,p_key:key,p_size:body.file_size,p_fingerprint:body.fingerprint},db):await rpcCall('read_cinema_upload',ownerArgs,db);
      if(result?.error) return reply({error:Object.hasOwn(errors,result.error)?result.error:'temporarily_unavailable'},errors[result.error]||503);
      let row=action==='start'?result:result?.upload;
      if(action==='start') {
        if(!UUID.test(row?.id||'')||typeof row.claimed!=='boolean') return reply({error:'temporarily_unavailable'},503);
        if(row.claimed) {
          // No second provider create after timeout/ambiguous result. The durable
          // provisioning reservation remains counted until an operator reconciles it.
          const video=await createVideo(row,cfg);
          const attached=await rpcCall('attach_cinema_upload',{p_id:row.id,p_uid:video.uid,p_url:video.url},db);
          if(attached?.ok!==true) return reply({error:'upload_needs_reconciliation'},503);
        }
      } else if(action==='refresh' && row?.stream_uid && ['uploading','processing'].includes(row.state)) {
        const observedAt=new Date().toISOString();
        const video=await readVideo(row.stream_uid,cfg),observation=mediaObservation(video);
        if(observation) {
          const updated=await rpcCall('observe_cinema_upload',{...observation,p_observed_at:observedAt},db);
          if(updated?.ok!==true) return reply({error:'temporarily_unavailable'},503);
        }
      }
      // Recheck current permission after provider I/O; do not release a grant to
      // an identity that was revoked during provisioning.
      result=await rpcCall('read_cinema_upload',ownerArgs,db);
      if(result?.error) return reply({error:'upload_not_allowed'},403);
      if(!result||!Object.hasOwn(result,'upload')) return reply({error:'temporarily_unavailable'},503);
      row=result.upload;
      return reply({upload:uploadProjection(row)});
    } catch { return reply({error:'temporarily_unavailable'},503); }
  };
}
