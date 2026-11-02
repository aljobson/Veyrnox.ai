import { NextResponse } from 'next/server';
import { rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';
import { adminGate, NO_STORE } from '../../../../../lib/adminGate.js';
import { changesQuery } from '../../../../../lib/adminChangesQuery.js';
import { panelAccess } from '../../../../../lib/adminPanelApi.js';

const reply = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req) {
  const g = await adminGate(req);
  if (g.response) {
    g.response.headers.set('Cache-Control', 'no-store');
    return g.response;
  }
  const query = changesQuery(new URL(req.url).searchParams);
  if (query.error) return reply({ error: query.error }, 400);
  try {
    const access = await panelAccess(g, 'changes.read');
    const result = await rpc('admin_changes_feed', { p_auth_id: g.authId, ...query.args }, g.cfg);
    if (!result || result.ok !== true) return reply({ error: 'changes_unavailable' }, 503);
    return reply({ entries: Array.isArray(result.entries) ? result.entries : [], next_cursor: result.next_cursor ?? null, permissions: access.permissions });
  } catch (err) {
    if (err instanceof SupabaseError && err.body?.code === '42501') return reply({ error: err.body.message === 'permission_denied' ? 'permission_denied' : 'not_admin' }, 403);
    if (err instanceof SupabaseError && err.body?.code === '22023') return reply({ error: 'filters_invalid' }, 400);
    // Never log RPC bodies: they can contain audit text or operator email.
    console.error('[admin/changes] read failed', err instanceof SupabaseError ? err.status : 0);
    return reply({ error: 'changes_unavailable' }, 503);
  }
}
