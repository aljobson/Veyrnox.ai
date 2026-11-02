import { adminGate } from '../../../../../lib/adminGate.js';
import { panelGateResponse, panelRead, panelReply, panelWindow } from '../../../../../lib/adminPanelApi.js';
export async function GET(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  const args = panelWindow(req, true);
  return args ? panelRead(g, 'admin_referrals_summary', args, 'affiliates') : panelReply({ error: 'filters_invalid' }, 400);
}
