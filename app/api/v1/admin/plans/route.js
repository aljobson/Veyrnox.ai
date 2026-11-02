import { adminGate } from '../../../../../lib/adminGate.js';
import { panelGateResponse, panelRead, panelReply, panelWrite, panelWriteInput } from '../../../../../lib/adminPanelApi.js';
export async function GET(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  if ([...new URL(req.url).searchParams].length) return panelReply({ error: 'filters_invalid' }, 400);
  return panelRead(g, 'admin_plans_list', {}, 'plans.read');
}
export async function POST(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  const input = await panelWriteInput(req);
  if (input.response) return input.response;
  const { body, trusted } = input;
  if (Object.keys(body).some(k => !['kind','id','active','reason'].includes(k)) || !['pack','subscription'].includes(body.kind)
    || typeof body.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(body.id) || typeof body.active !== 'boolean') return panelReply({ error: 'input_invalid' }, 400);
  return panelWrite(g, 'admin_plan_set_active', { p_kind: body.kind, p_id: body.id, p_active: body.active, ...trusted }, 'plans.write');
}
