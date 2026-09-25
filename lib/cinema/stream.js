import { readBoundedBody } from '../boundedBody.js';
export const STREAM_UID = /^[A-Za-z0-9]{32}$/;
import { validUploadUrl } from './uploadPolicy.js';
export { validUploadUrl } from './uploadPolicy.js';
export function streamConfig(env=process.env) {
  if (!/^[a-f0-9]{32}$/.test(env.CINEMA_STREAM_ACCOUNT_ID || '') || !env.CINEMA_STREAM_API_TOKEN || !env.CINEMA_STREAM_WEBHOOK_SECRET) throw Error('stream_unconfigured');
  return {account:env.CINEMA_STREAM_ACCOUNT_ID,token:env.CINEMA_STREAM_API_TOKEN};
}
export async function createStreamUpload(row, cfg, fetcher=fetch) {
  const res=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${cfg.account}/stream?direct_user=true`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${cfg.token}`,
      'Tus-Resumable':'1.0.0','Upload-Length':String(row.file_size),
      'Upload-Metadata':`maxDurationSeconds ${btoa('600')},requiresignedurls,expiry ${btoa(new Date(row.expires_at).toISOString())},name ${btoa(`cinema_${row.id}`)}`}});
  const uid=res.headers.get('stream-media-id'),url=res.headers.get('location');
  if(res.body) await res.body.cancel();
  if(res.status!==201 || !STREAM_UID.test(uid || '') || !validUploadUrl(url)) throw Error('stream_create_failed');
  return {uid,url};
}
export async function readStreamVideo(uid,cfg,fetcher=fetch) {
  if(typeof uid!=='string'||!STREAM_UID.test(uid)) throw Error('invalid_uid');
  const signal=AbortSignal.timeout(10000);
  const res=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${cfg.account}/stream/${uid}`,{redirect:'error',signal,headers:{Authorization:`Bearer ${cfg.token}`}});
  const bytes=await readBoundedBody(res.body,65536,signal);
  if(!res.ok) throw Error('stream_read_failed');
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(body.success!==true || body.result?.uid!==uid) throw Error('stream_read_failed');
  return body.result;
}
export async function deleteStreamVideo(uid,cfg,fetcher=fetch) {
  if(typeof uid!=='string'||!STREAM_UID.test(uid)) throw Error('invalid_uid');
  const signal=AbortSignal.timeout(10000);
  const res=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${cfg.account}/stream/${uid}`,{
    method:'DELETE',redirect:'error',signal,headers:{Authorization:`Bearer ${cfg.token}`}});
  const bytes=await readBoundedBody(res.body,65536,signal);
  // Never interpret an auth error, generic 404 or ambiguous response as proof
  // of deletion. Retain the reservation for operator reconciliation instead.
  if(res.status===204) return {ok:true};
  if(res.status===200) {
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(body.success===true && Array.isArray(body.errors) && body.errors.length===0) return {ok:true};
  }
  throw Error('stream_delete_unconfirmed');
}
export function mediaObservation(video) {
  if(typeof video?.uid!=='string'||!STREAM_UID.test(video.uid)) throw Error('invalid_video');
  if(video.status?.state==='error') return {p_uid:video.uid,p_state:'error',p_duration:null,p_width:null,p_height:null};
  if(video.status?.state==='ready' && Number(video.status.pctComplete)===100 && video.readyToStream===true) {
    const {duration,input}=video;
    const valid=video.requireSignedURLs===true && Number.isFinite(duration) && duration>=0.1 && duration<=600 && Number.isInteger(input?.width) && input.width>0 && input.width<=32768 && Number.isInteger(input?.height) && input.height>0 && input.height<=32768;
    return {p_uid:video.uid,p_state:valid?'ready':'error',p_duration:valid?duration:null,p_width:valid?input.width:null,p_height:valid?input.height:null};
  }
  if(!['queued','inprogress','ready','pendingupload','downloading'].includes(video.status?.state)) throw Error('invalid_video');
  return video.status.state==='pendingupload'?null:{p_uid:video.uid,p_state:'processing',p_duration:null,p_width:null,p_height:null};
}
export async function verifyStreamSignature(bytes,header,secret,now=Math.floor(Date.now()/1000)) {
  if(!secret || typeof header!=='string' || header.length>256) return false;
  const match=/^time=(\d{1,12}),sig1=([a-f0-9]{64})$/.exec(header);
  if(!match || Number(match[1])<now-300 || Number(match[1])>now+5) return false;
  const prefix=new TextEncoder().encode(`${match[1]}.`),message=new Uint8Array(prefix.length+bytes.length); message.set(prefix);message.set(bytes,prefix.length);
  const signature=Uint8Array.from(match[2].match(/../g),x=>parseInt(x,16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,signature,message);
}
