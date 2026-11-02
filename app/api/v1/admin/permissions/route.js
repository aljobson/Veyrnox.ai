import { adminGate } from '../../../../../lib/adminGate.js';
import { panelAccess, panelFailure, panelGateResponse, panelReply } from '../../../../../lib/adminPanelApi.js';
export async function GET(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  if ([...new URL(req.url).searchParams].length) return panelReply({ error: 'filters_invalid' }, 400);
  try { return panelReply(await panelAccess(g)); } catch (error) { return panelFailure(error); }
}
