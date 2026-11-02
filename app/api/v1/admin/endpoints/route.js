import { adminGate } from '../../../../../lib/adminGate.js';
import { panelAccess, panelFailure, panelGateResponse, panelReply } from '../../../../../lib/adminPanelApi.js';
import { rpc } from '../../../../../packages/db/supabase-client.js';
import inventory from '../../../../../lib/adminRouteInventory.json' with { type: 'json' };
export async function GET(req) {
  const g = await adminGate(req);
  if (g.response) return panelGateResponse(g);
  if ([...new URL(req.url).searchParams].length) return panelReply({ error: 'filters_invalid' }, 400);
  try {
    const access = await panelAccess(g, 'endpoints');
    const webhooks = await rpc('admin_webhook_deliveries', { p_auth_id: g.authId, p_hours: 24, p_limit: 1 }, g.cfg);
    if (webhooks?.ok !== true) return panelReply({ error: 'admin_unavailable' }, 503);
    const usage = await rpc('admin_endpoint_usage', { p_auth_id: g.authId }, g.cfg);
    if (usage?.ok !== true) return panelReply({ error: 'admin_unavailable' }, 503);
    return panelReply({ ok: true, permissions: access.permissions, inventory, webhooks: webhooks.by_source || [], telemetry: usage.telemetry === true, usage: usage.usage || [] });
  } catch (error) { return panelFailure(error); }
}
