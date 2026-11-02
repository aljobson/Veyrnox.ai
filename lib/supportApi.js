import { readBoundedBody } from './boundedBody.js';
import { IDEMPOTENCY_RE, UUID_RE } from './adminGate.js';
import { panelReply } from './adminPanelApi.js';
export const SUPPORT_CATEGORIES=['billing','account','generation','other'];
export const SUPPORT_STATUSES=['open','pending','solved'];
export async function supportBody(req) {
  const key=req.headers.get('idempotency-key');
  if(!IDEMPOTENCY_RE.test(key||''))return {response:panelReply({error:'idempotency_key_invalid'},400)};
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return {response:panelReply({error:'body_invalid'},400)};
  let body;
  try{body=JSON.parse(new TextDecoder().decode(await readBoundedBody(req.body,24000,req.signal)));}
  catch(e){return {response:panelReply({error:e.status===413?'body_too_large':'body_invalid'},e.status===413?413:400)};}
  if(!body||typeof body!=='object'||Array.isArray(body))return {response:panelReply({error:'body_invalid'},400)};
  return {body,key};
}
export const supportText=(s,max)=>typeof s==='string'&&s.trim().length>=1&&s.trim().length<=max&&!s.includes('\0');
export function supportQuery(params) {
  for(const key of params.keys())if(!['ticket','status','before'].includes(key)||params.getAll(key).length!==1)return null;
  const ticket=params.get('ticket'),status=params.get('status');let before=null;
  if(params.has('ticket')&&!UUID_RE.test(ticket||'')||params.has('status')&&!SUPPORT_STATUSES.includes(status)||ticket&&status)return null;
  if(params.has('before')) {
    try{before=JSON.parse(params.get('before'));}catch{return null;}
    if(!before||Array.isArray(before)||Object.keys(before).sort().join(',')!=='created_at,id'||typeof before.id!=='string'||!UUID_RE.test(before.id)
      ||typeof before.created_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(before.created_at)||!Number.isFinite(Date.parse(before.created_at))||new Date(before.created_at).toISOString().slice(0,19)!==before.created_at.slice(0,19))return null;
  }
  return {ticket:ticket||null,status:status||null,before};
}
export function supportResult(result) {
  if(result?.ok===true)return panelReply(result);
  const status={not_authenticated:401,support_unavailable:404,ticket_not_found:404,ticket_erased:409,assignee_invalid:409,idempotency_key_reused:409,rate_limited:429,ticket_limit:409};
  return panelReply({error:Object.hasOwn(status,result?.code)?result.code:'support_unavailable'},status[result?.code]||503);
}
