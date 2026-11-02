import { adminGate,UUID_RE } from '../../../../../lib/adminGate.js';
import { panelAccess,panelFailure,panelGateResponse,panelReply } from '../../../../../lib/adminPanelApi.js';
import { supportBody,supportText,supportQuery,supportResult,SUPPORT_STATUSES } from '../../../../../lib/supportApi.js';
import { rpc } from '../../../../../packages/db/supabase-client.js';
export async function GET(req) {
  const g=await adminGate(req);
  if(g.response)return panelGateResponse(g);
  const query=supportQuery(new URL(req.url).searchParams);
  if(!query)return panelReply({error:'filters_invalid'},400);
  try {
    const access=await panelAccess(g,'support');
    const data=await rpc(query.ticket?'admin_support_get':'admin_support_list',{p_auth_id:g.authId,p_before:query.before,...(query.ticket?{p_ticket:query.ticket}:{p_status:query.status,p_limit:50})},g.cfg);
    if(data?.ok!==true)return supportResult(data);
    const log=query.ticket?await rpc('admin_support_agent_log',{p_auth_id:g.authId,p_ticket:query.ticket},g.cfg):{ok:true,runs:[]};
    if(log?.ok!==true)return panelReply({error:'support_unavailable'},503);
    return panelReply({...data,permissions:access.permissions,actor_user_id:access.user_id,runs:log.runs});
  }catch(e){return panelFailure(e);}
}
export async function POST(req) {
  const g=await adminGate(req);
  if(g.response)return panelGateResponse(g);
  const input=await supportBody(req);
  if(input.response)return input.response;
  const {body,key}=input;
  const fields={reply:['body'],status:['status'],assign:['assignee']};
  if(typeof body.action!=='string'||!Object.hasOwn(fields,body.action)||Object.keys(body).some(k=>!['action','ticket','reason',...fields[body.action]].includes(k))||typeof body.ticket!=='string'||!UUID_RE.test(body.ticket)
    ||body.reason!=='support-'+body.action||body.action==='reply'&&!supportText(body.body,5000)||body.action==='status'&&!SUPPORT_STATUSES.includes(body.status)
    ||body.action==='assign'&&body.assignee!==null&&(typeof body.assignee!=='string'||!UUID_RE.test(body.assignee)))return panelReply({error:'input_invalid'},400);
  try {
    await panelAccess(g,'support.write');
    const value=body.action==='reply'?{p_body:body.body.trim()}:body.action==='status'?{p_status:body.status}:{p_assignee:body.assignee};
    return supportResult(await rpc({reply:'admin_support_reply',status:'admin_support_set_status',assign:'admin_support_assign'}[body.action],
      {p_auth_id:g.authId,p_ticket:body.ticket,p_reason:body.reason,p_idem_key:key,...value},g.cfg));
  }catch(e){return panelFailure(e);}
}
