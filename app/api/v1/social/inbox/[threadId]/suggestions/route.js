import { NextResponse } from 'next/server';
import { limitRequestBody } from '../../../../../../../lib/requestBodyLimit.js';
import { publishPlansEnabled, socialInboxEnabled, socialInboxWorkflowsEnabled } from '../../../../../../../lib/social/publishFeature.js';
import { socialPostWriteLimit } from '../../../../../../../lib/socialPostWriteLimit.js';
import { resolveBrand } from '../../../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'no-store' };
function identity(req, threadId) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!UUID.test(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers }) };
  if (!UUID.test(threadId || '')) return { error: NextResponse.json({ error: 'invalid_thread_id' }, { status: 400, headers }) };
  if (!socialInboxEnabled() || !socialInboxWorkflowsEnabled()) return { error: NextResponse.json({ error: 'inbox_workflows_not_open' }, { status: 503, headers }) };
  if (!publishPlansEnabled()) return { error: NextResponse.json({ error: 'publish_plans_not_open' }, { status: 503, headers }) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503, headers }) };
  return { authId, cfg };
}
function failure(result) {
  const code = result?.code; const status = code === 'PLAN_REQUIRED' ? 402 : code === 'FORBIDDEN' ? 403
    : ['THREAD_NOT_FOUND', 'SUGGESTION_NOT_FOUND'].includes(code) ? 404 : code === 'INVALID_ACTION' ? 400 : 502;
  return NextResponse.json({ error: status === 502 ? 'internal' : String(code).toLowerCase() }, { status, headers });
}
export async function GET(req, context) {
  const { threadId } = await context.params; const resolved = identity(req, threadId); if (resolved.error) return resolved.error;
  const brand = await resolveBrand(resolved.authId, resolved.cfg, 'api/v1/social/inbox/suggestions:GET', {
    request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'],
  });
  if (brand.error) return brand.error;
  try {
    const result = await rpc('list_social_inbox_suggestions', { p_auth_id: resolved.authId, p_brand_id: brand.brandId, p_thread_id: threadId }, resolved.cfg);
    return result?.ok === true ? NextResponse.json({ suggestions: result.suggestions || [] }, { headers }) : failure(result);
  } catch (error) {
    console.error('[api/v1/social/inbox/suggestions:GET] read failed:', error instanceof SupabaseError ? error.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502, headers });
  }
}
export async function PATCH(req, context) {
  const { threadId } = await context.params; const resolved = identity(req, threadId); if (resolved.error) return resolved.error;
  const limited = await limitRequestBody(req); if (limited.response) return limited.response;
  let body; try { body = await limited.request.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers }); }
  if (!UUID.test(body?.suggestionId || '') || !['use', 'dismiss'].includes(body?.action) || Object.keys(body || {}).length !== 2) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400, headers });
  }
  const brand = await resolveBrand(resolved.authId, resolved.cfg, 'api/v1/social/inbox/suggestions:PATCH', {
    request: req, allowedRoles: ['owner', 'manager', 'editor'],
  });
  if (brand.error) return brand.error;
  const rate = await socialPostWriteLimit(resolved.authId, resolved.cfg); if (rate) return rate;
  try {
    const result = await rpc('decide_social_inbox_suggestion', { p_auth_id: resolved.authId, p_brand_id: brand.brandId,
      p_thread_id: threadId, p_suggestion_id: body.suggestionId, p_action: body.action }, resolved.cfg);
    return result?.ok === true ? NextResponse.json({ suggestedReply: result.suggested_reply }, { headers }) : failure(result);
  } catch (error) {
    console.error('[api/v1/social/inbox/suggestions:PATCH] update failed:', error instanceof SupabaseError ? error.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502, headers });
  }
}
