import { adminGate } from '../../../../../lib/adminGate.js';
import { panelGateResponse, panelRead, panelReply, panelWindow } from '../../../../../lib/adminPanelApi.js';
export async function GET(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  const args = panelWindow(req);
  return args ? panelRead(g, 'admin_revenue_summary', args, 'payments') : panelReply({ error: 'filters_invalid' }, 400);
}
