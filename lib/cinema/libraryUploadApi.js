// POST /api/v1/cinema/uploads/from-library (ADR-0052 amendment 1): attach one of the
// caller's own finished Library videos to their draft. The source remains in private R2
// quarantine until the dedicated scanner admits the exact bytes to Stream.
import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { uploadSafetyHold } from './uploadPolicy.js';
import { cinemaFeatures } from './features.js';
import { uploadProjection } from './uploadApi.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const errors={upload_not_allowed:403,source_not_found:404,source_not_video:400,invalid_upload:400,idempotency_conflict:409,upload_exists:409,upload_removed:409,upload_needs_reconciliation:409,upload_capacity_reached:429};

export function libraryUploadHandler({rpcCall=rpc}={}) {
  return async req=>{
    const id=crypto.randomUUID(),auth=req.headers.get('x-veyrnox-auth-id');
    const reply=(body,status=200)=>{
      console.info(JSON.stringify({event:'cinema.upload',request_id:id,actor_id:UUID.test(auth||'')?auth:undefined,action:'from_library',status,code:body.error||'ok'}));
      return Response.json({...body,request_id:id},{status,headers:{'Cache-Control':'no-store','x-request-id':id,...(status===429?{'Retry-After':'60'}:{})}});
    };
    if(!UUID.test(auth||'')) return reply({error:'not_authenticated'},401);
    const flags=cinemaFeatures(process.env);
    if(!flags.content||!flags.uploads) return reply({error:'uploads_not_open'},503);
    try {
      if(new URL(req.url).searchParams.size) return reply({error:'invalid_upload'},400);
      if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json') return reply({error:'invalid_content_type'},415);
      const limited=await limitRequestBody(req);if(limited.response) return reply({error:'invalid_body'},limited.response.status);
      let body;
      try { body=await limited.request.json(); } catch { return reply({error:'invalid_body'},400); }
      if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['content_id','job_id'].includes(k))
        ||typeof body.content_id!=='string'||!UUID.test(body.content_id)||typeof body.job_id!=='string'||!UUID.test(body.job_id)) return reply({error:'invalid_upload'},400);
      const key=req.headers.get('idempotency-key');
      if(!UUID.test(key||'')) return reply({error:'invalid_idempotency_key'},400);
      // This path may open independently of browser uploads, but only after the
      // private scanner service and migration are both active.
      if(process.env.CINEMA_QUARANTINE_SCANNER_ENABLED!=='true') return reply({error:'upload_safety_hold'},503);
      const db=envConfig();
      const rate=await rpcCall('consume_account_read_request',{p_auth_id:auth},db);
      if(rate?.code==='RATE_LIMITED') return reply({error:'rate_limited'},429);
      if(rate?.ok!==true) return reply({error:'temporarily_unavailable'},503);
      const ownerArgs={p_auth_id:auth,p_content_id:body.content_id};
      const reserved=await rpcCall('reserve_cinema_library_upload',{...ownerArgs,p_job_id:body.job_id,p_key:key},db);
      if(reserved?.error) return reply({error:Object.hasOwn(errors,reserved.error)?reserved.error:'temporarily_unavailable'},errors[reserved.error]||503);
      if(!UUID.test(reserved?.id||'')||typeof reserved.claimed!=='boolean') return reply({error:'temporarily_unavailable'},503);
      // Recheck current permission after the durable queue write. The scanner owns
      // every later read, verdict and provider call.
      const result=await rpcCall('read_cinema_upload',ownerArgs,db);
      if(result?.error) return reply({error:'upload_not_allowed'},403);
      if(!result||!Object.hasOwn(result,'upload')) return reply({error:'temporarily_unavailable'},503);
      return reply({upload:uploadProjection(result.upload),proxy_uploads_enabled:!uploadSafetyHold(process.env),library_uploads_enabled:true},reserved.claimed?202:200);
    } catch { return reply({error:'temporarily_unavailable'},503); }
  };
}
