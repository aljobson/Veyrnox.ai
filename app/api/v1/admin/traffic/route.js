import { adminGate } from '../../../../../lib/adminGate.js';
import { panelGateResponse, panelRead, panelReply, panelWindow } from '../../../../../lib/adminPanelApi.js';
export async function GET(req) {
  const g=await adminGate(req);
  if(g.response)return panelGateResponse(g);
  const args=panelWindow(req);
  if(!args||args.p_days>90)return panelReply({error:'filters_invalid'},400);
  return panelRead(g,'admin_traffic_summary',args,'traffic');
}
