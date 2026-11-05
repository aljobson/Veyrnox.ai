import { adminGate } from '../../../../../../lib/adminGate.js';
import { panelGateResponse, panelRead, panelReply, panelWrite, panelWriteInput } from '../../../../../../lib/adminPanelApi.js';

// ADR-0327. Reuses the switches.write permission and its fresh-second-factor rule.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  const params = [...new URL(req.url).searchParams];
  if (params.length > 1 || (params[0] && params[0][0] !== 'email') || (params[0] && params[0][1].length > 320)) {
    return panelReply({ error: 'filters_invalid' }, 400);
  }
  return panelRead(g, 'admin_ai_control_get', { p_email: params[0]?.[1] ?? null }, 'switches.write');
}

export async function POST(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  const input = await panelWriteInput(req);
  if (input.response) return input.response;
  const { body, trusted } = input;
  const userId = body.user_id ?? null;
  const limit = body.gen_limit_per_window ?? null;
  const disabled = body.ai_disabled ?? false;
  if (Object.keys(body).some(k => !['user_id', 'ai_disabled', 'gen_limit_per_window', 'reason'].includes(k))
    || (userId !== null && (typeof userId !== 'string' || !UUID.test(userId)))
    || typeof disabled !== 'boolean'
    || (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 10))
    || (userId === null && disabled)
    || typeof body.reason !== 'string') return panelReply({ error: 'input_invalid' }, 400);
  return panelWrite(g, 'admin_ai_control_set', {
    p_user_id: userId, p_ai_disabled: disabled, p_limit: limit, p_reason: body.reason, ...trusted,
  }, 'switches.write');
}
