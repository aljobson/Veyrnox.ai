import { adminGate } from '../../../../../lib/adminGate.js';
import { RUNTIME_SWITCHES } from '../../../../../lib/runtimeSwitches.js';
import { panelGateResponse, panelRead, panelReply, panelWrite, panelWriteInput } from '../../../../../lib/adminPanelApi.js';
export async function GET(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  if ([...new URL(req.url).searchParams].length) return panelReply({ error: 'filters_invalid' }, 400);
  return panelRead(g, 'admin_switch_list', {}, 'switches.write');
}
export async function POST(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  const input = await panelWriteInput(req);
  if (input.response) return input.response;
  const { body, trusted } = input;
  if (Object.keys(body).some(k => !['key','state','reason'].includes(k)) || !Object.hasOwn(RUNTIME_SWITCHES,body.key)
    || !['on','off'].includes(body.state)) return panelReply({ error: 'input_invalid' }, 400);
  return panelWrite(g, 'admin_switch_set', { p_key: body.key, p_state: body.state, ...trusted }, 'switches.write');
}
