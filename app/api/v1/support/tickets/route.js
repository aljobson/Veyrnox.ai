import { UUID_RE } from '../../../../../lib/adminGate.js';
import { panelReply } from '../../../../../lib/adminPanelApi.js';
import { cachedRuntimeEnabled } from '../../../../../lib/runtimeSwitchCache.js';
import { supportBody,supportText,supportResult,SUPPORT_CATEGORIES } from '../../../../../lib/supportApi.js';
import { envConfig,rpc } from '../../../../../packages/db/supabase-client.js';
export async function POST(req) {
  const auth=req.headers.get('x-veyrnox-auth-id');
  if(!UUID_RE.test(auth||''))return panelReply({error:'not_authenticated'},401);
  if(!cachedRuntimeEnabled('support_intake'))return panelReply({error:'support_unavailable'},404);
  const input=await supportBody(req);
  if(input.response)return input.response;
  const {body,key}=input;
  if(Object.keys(body).some(k=>!['subject','category','body'].includes(k))||!supportText(body.subject,200)||/[\x00-\x1f\x7f]/.test(body.subject)
    ||!supportText(body.body,5000)||!SUPPORT_CATEGORIES.includes(body.category))return panelReply({error:'input_invalid'},400);
  const cfg=envConfig();
  if(!cfg.supabaseUrl||!cfg.serviceRoleKey)return panelReply({error:'support_unavailable'},503);
  try{return supportResult(await rpc('support_ticket_create',{p_auth_id:auth,p_subject:body.subject.trim(),p_category:body.category,p_body:body.body.trim(),p_idem_key:key},cfg));}
  catch{console.error('[support] intake unavailable');return panelReply({error:'support_unavailable'},503);}
}
