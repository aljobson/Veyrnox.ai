import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialTeamsEnabled } from '../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { decodeActivityCursor } from '../../../../../lib/social/activityCursor.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'no-store' };

export async function GET(req) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!UUID.test(authId || '')) return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers });
  if (!socialTeamsEnabled()) return NextResponse.json({ error: 'teams_not_open' }, { status: 404, headers });
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503, headers });
  const limited = await accountReadLimit(authId, cfg, { events: [] }); if (limited) return limited;
  const params = new URL(req.url).searchParams;
  const rawLimit = Number(params.get('limit') || 50);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) return NextResponse.json({ error: 'invalid_limit' }, { status: 400, headers });
  let cursor = null;
  if (params.has('cursor')) {
    try { cursor = decodeActivityCursor(params.get('cursor')); }
    catch { return NextResponse.json({ error: 'invalid_cursor' }, { status: 400, headers }); }
  }
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/activity:GET', { request: req, allowedRoles: ['owner', 'manager'] });
  if (brand.error) return brand.error;
  try {
    let result;
    let legacy = false;
    try {
      result = await rpc('list_social_publish_activity_page', {
        p_auth_id: authId, p_brand_id: brand.brandId, p_limit: rawLimit,
        p_before_created_at: cursor?.created_at || null, p_before_id: cursor?.id || null, p_before_source: cursor?.source || null,
      }, cfg);
    } catch (error) {
      if (!(error instanceof SupabaseError) || error.status !== 404 || error.body?.code !== 'PGRST202') throw error;
      if (cursor) return NextResponse.json({ error: 'activity_history_upgrading' }, { status: 503, headers });
      result = await rpc('list_social_publish_activity', { p_auth_id: authId, p_brand_id: brand.brandId, p_limit: rawLimit }, cfg);
      legacy = true;
    }
    if (result?.ok !== true) {
      const status = result?.code === 'PLAN_REQUIRED' ? 402 : result?.code === 'FORBIDDEN' ? 403 : result?.code === 'BRAND_NOT_FOUND' ? 404 : 502;
      return NextResponse.json({ error: String(result?.code || 'internal').toLowerCase() }, { status, headers });
    }
    return NextResponse.json({ actor_role: result.actor_role, events: result.events || [], next_cursor: result.next_cursor || null,
      ...(legacy ? { history_limited: true, notice: `Showing the latest ${rawLimit} entries. Older history will be available after the activity history upgrade.` } : {}),
    }, { headers });
  } catch (error) {
    console.error('[api/v1/social/activity:GET] failed:', error instanceof SupabaseError ? error.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502, headers });
  }
}
