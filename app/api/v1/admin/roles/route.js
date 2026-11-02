import { adminGate, UUID_RE } from '../../../../../lib/adminGate.js';
import { ADMIN_ROLES } from '../../../../../lib/adminPermissions.js';
import { panelGateResponse, panelRead, panelReply, panelWrite, panelWriteInput } from '../../../../../lib/adminPanelApi.js';
export async function GET(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  if ([...new URL(req.url).searchParams].length) return panelReply({ error: 'filters_invalid' }, 400);
  return panelRead(g, 'admin_roles_list', {}, 'roles.write');
}
export async function POST(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  const input = await panelWriteInput(req);
  if (input.response) return input.response;
  const { body, trusted } = input;
  if (Object.keys(body).some(k => !['target_user','role','action','reason'].includes(k))
    || typeof body.target_user !== 'string' || !UUID_RE.test(body.target_user) || !['set','revoke'].includes(body.action)
    || (body.action === 'set' ? !ADMIN_ROLES.includes(body.role) : Object.hasOwn(body,'role'))) return panelReply({ error: 'input_invalid' }, 400);
  return panelWrite(g, body.action === 'set' ? 'admin_role_set' : 'admin_role_revoke',
    { p_target_user: body.target_user, ...(body.action === 'set' ? { p_role: body.role } : {}), ...trusted }, 'roles.write');
}
