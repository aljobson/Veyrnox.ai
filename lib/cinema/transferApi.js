import {rpc,envConfig} from '../../packages/db/supabase-client.js';
import {readBoundedBody} from '../boundedBody.js';
import {cinemaFeatures} from './features.js';
import {uploadSafetyHold,UPLOAD_CHUNK_BYTES,validUploadUrl} from './uploadPolicy.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const statuses={upload_not_allowed:403,upload_removed:410,upload_busy:409,upload_not_writable:409,upload_needs_reconciliation:409};
const number=value=>/^\d{1,10}$/.test(value||'')&&Number.isSafeInteger(Number(value))?Number(value):null;

// The hold is enforced by the public handler. This core is independently tested
// with synthetic claims; only database-returned, allowlisted URLs can reach fetch.
export async function transferChunk({req,uploadId,auth,contentId,bytes,offset,db},{rpcCall=rpc,fetcher=fetch}={}) {
  const key=crypto.randomUUID();let claimed=false,uncertainWrite=false;
  const reply=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
  try {
    const claim=await rpcCall('claim_cinema_transfer',{p_auth_id:auth,p_content_id:contentId,p_upload_id:uploadId,p_key:key},db);
    if(claim?.ok!==true) return reply(Object.hasOwn(statuses,claim?.error)?claim.error:'temporarily_unavailable',statuses[claim?.error]||503);
    claimed=true;
    if(!validUploadUrl(claim.upload_url)||!Number.isSafeInteger(claim.file_size)||claim.file_size<1||claim.file_size>2147483648) throw Error('invalid_claim');
    const send=(method,headers={},body)=>fetcher(claim.upload_url,{method,redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',
      signal:AbortSignal.timeout(30000),headers:{'Tus-Resumable':'1.0.0',...headers},body});
    const head=await send('HEAD');
    const current=number(head.headers.get('upload-offset')),length=number(head.headers.get('upload-length'));
    if(head.body) await head.body.cancel();
    if(head.status!==200||current===null||length!==claim.file_size||current>length) throw Error('invalid_offset');
    if(req.method==='GET') return Response.json({offset:current,length},{headers:{'Cache-Control':'no-store'}});
    if(offset!==current) return reply('upload_offset_conflict',409);
    if(!bytes?.length||bytes.length>UPLOAD_CHUNK_BYTES||offset+bytes.length>length||(bytes.length!==UPLOAD_CHUNK_BYTES&&offset+bytes.length!==length)) return reply('invalid_chunk',400);
    // A timeout/connection failure can leave a write running at the provider.
    // Retain the durable claim on ANY unconfirmed PATCH, including HTTP errors.
    uncertainWrite=true;
    const patched=await send('PATCH',{'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)},bytes);
    const next=number(patched.headers.get('upload-offset'));
    if(patched.body) await patched.body.cancel();
    if(patched.status!==204||next!==offset+bytes.length) return reply('upload_needs_reconciliation',503);
    uncertainWrite=false;
    return Response.json({offset:next,length},{headers:{'Cache-Control':'no-store'}});
  } catch { return reply(uncertainWrite?'upload_needs_reconciliation':'temporarily_unavailable',503); }
  finally {
    if(claimed&&!uncertainWrite) {
      // Failure to release remains fail-closed. No automatic timeout can unlock it.
      try { await rpcCall('finish_cinema_transfer',{p_upload_id:uploadId,p_key:key},db); } catch { /* retained for reconciliation */ }
    }
  }
}

export function transferHandler({rpcCall=rpc,fetcher=fetch}={}) {
  return async (req,uploadId)=>{
    const requestId=crypto.randomUUID();
    const reply=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
    const finish=async response=>{
      let code='ok';
      if(response.status>=400) try { code=(await response.clone().json()).error||'error'; } catch { code='error'; }
      const record=JSON.stringify({event:'cinema.upload_transfer',request_id:requestId,
        actor_id:UUID.test(auth||'')?auth:undefined,method:req.method,status:response.status,code});
      if(response.status>=500) console.error(record); else console.info(record);
      const headers=new Headers(response.headers);headers.set('x-request-id',requestId);
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    };
    const auth=req.headers.get('x-veyrnox-auth-id'),q=new URL(req.url).searchParams,contentId=q.get('content_id');
    if(!UUID.test(auth||'')) return finish(reply('not_authenticated',401));
    if(!['GET','PATCH'].includes(req.method)) return finish(reply('method_not_allowed',405));
    if(!UUID.test(uploadId||'')||!UUID.test(contentId||'')||q.size!==1) return finish(reply('invalid_upload',400));
    const flags=cinemaFeatures(process.env);
    if(!flags.content||!flags.uploads) return finish(reply('uploads_not_open',503));
    if(uploadSafetyHold(process.env)) return finish(reply('upload_safety_hold',503));
    let db;
    try {
      db=envConfig();
      const rate=await rpcCall('consume_upload_request',{p_auth_id:auth},db);
      if(rate?.code==='RATE_LIMITED') return finish(reply('rate_limited',429));
      if(rate?.code==='NOT_FOUND') return finish(reply('upload_not_allowed',403));
      if(rate?.ok!==true) return finish(reply('temporarily_unavailable',503));
    } catch { return finish(reply('temporarily_unavailable',503)); }
    let bytes,offset;
    if(req.method==='PATCH') {
      if(req.headers.get('content-type')!=='application/offset+octet-stream') return finish(reply('invalid_content_type',415));
      offset=number(req.headers.get('upload-offset'));
      if(offset===null) return finish(reply('invalid_offset',400));
      try { bytes=await readBoundedBody(req.body,UPLOAD_CHUNK_BYTES,AbortSignal.timeout(10000)); }
      catch(e) { return finish(reply(e?.status===413?'body_too_large':'invalid_body',e?.status===413?413:400)); }
    }
    return finish(await transferChunk({req,uploadId,auth,contentId,bytes,offset,db},{rpcCall,fetcher}));
  };
}
