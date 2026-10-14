import { NextResponse } from 'next/server';
import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';
import { publishPlansEnabled, socialInboxEnabled, socialInboxWorkflowsEnabled } from '../../../../../lib/social/publishFeature.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['message', 'comment', 'review']);
const MATCHES = new Set(['contains', 'exact']);
const headers = { 'Cache-Control': 'no-store' };

function identity(req) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!UUID.test(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers }) };
  if (!socialInboxEnabled() || !socialInboxWorkflowsEnabled()) return { error: NextResponse.json({ error: 'inbox_workflows_not_open' }, { status: 503, headers }) };
  if (!publishPlansEnabled()) return { error: NextResponse.json({ error: 'publish_plans_not_open' }, { status: 503, headers }) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503, headers }) };
  return { authId, cfg };
}

function failure(result) {
  const code = result?.code;
  const status = code === 'PLAN_REQUIRED' ? 402 : code === 'FORBIDDEN' ? 403
    : ['WORKFLOW_NOT_FOUND', 'ACCOUNT_NOT_FOUND'].includes(code) ? 404
      : ['INVALID_WORKFLOW', 'WORKFLOW_LIMIT'].includes(code) ? 400 : 502;
  return NextResponse.json({ error: status === 502 ? 'internal' : String(code).toLowerCase() }, { status, headers });
}

export async function GET(req) {
  const resolved = identity(req); if (resolved.error) return resolved.error;
  const brand = await resolveBrand(resolved.authId, resolved.cfg, 'api/v1/social/workflows:GET', {
    request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'],
  });
  if (brand.error) return brand.error;
  try {
    const result = await rpc('list_social_inbox_workflows', { p_auth_id: resolved.authId, p_brand_id: brand.brandId }, resolved.cfg);
    return result?.ok === true ? NextResponse.json({ workflows: result.workflows || [], brandRole: brand.role }, { headers }) : failure(result);
  } catch (error) {
    console.error('[api/v1/social/workflows:GET] read failed:', error instanceof SupabaseError ? error.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502, headers });
  }
}

export async function PUT(req) {
  const resolved = identity(req); if (resolved.error) return resolved.error;
  const limited = await limitRequestBody(req); if (limited.response) return limited.response;
  let body; try { body = await limited.request.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers }); }
  const workflowId = body?.id || null; const accountId = body?.accountId || null; const kind = body?.kind || null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
  const replyText = typeof body?.replyText === 'string' ? body.replyText.trim() : '';
  const matchMode = body?.matchMode;
  if (workflowId && !UUID.test(workflowId) || accountId && !UUID.test(accountId) || kind && !KINDS.has(kind)
    || !MATCHES.has(matchMode) || !name || name.length > 80 || !keyword || keyword.length > 100
    || !replyText || replyText.length > 8000 || typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'invalid_workflow' }, { status: 400, headers });
  }
  const brand = await resolveBrand(resolved.authId, resolved.cfg, 'api/v1/social/workflows:PUT', {
    request: req, allowedRoles: ['owner', 'manager', 'editor'],
  });
  if (brand.error) return brand.error;
  const rate = await socialPostWriteLimit(resolved.authId, resolved.cfg); if (rate) return rate;
  try {
    const result = await rpc('save_social_inbox_workflow', { p_auth_id: resolved.authId, p_brand_id: brand.brandId,
      p_workflow_id: workflowId, p_name: name, p_account_id: accountId, p_kind: kind, p_keyword: keyword,
      p_match_mode: matchMode, p_reply_text: replyText, p_enabled: body.enabled }, resolved.cfg);
    return result?.ok === true ? NextResponse.json({ id: result.workflow_id, created: result.created }, { status: result.created ? 201 : 200, headers }) : failure(result);
  } catch (error) {
    console.error('[api/v1/social/workflows:PUT] write failed:', error instanceof SupabaseError ? error.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502, headers });
  }
}

export async function DELETE(req) {
  const resolved = identity(req); if (resolved.error) return resolved.error;
  const id = new URL(req.url).searchParams.get('id');
  if (!UUID.test(id || '')) return NextResponse.json({ error: 'invalid_workflow' }, { status: 400, headers });
  const brand = await resolveBrand(resolved.authId, resolved.cfg, 'api/v1/social/workflows:DELETE', {
    request: req, allowedRoles: ['owner', 'manager', 'editor'],
  });
  if (brand.error) return brand.error;
  const rate = await socialPostWriteLimit(resolved.authId, resolved.cfg); if (rate) return rate;
  try {
    const result = await rpc('delete_social_inbox_workflow', { p_auth_id: resolved.authId, p_brand_id: brand.brandId, p_workflow_id: id }, resolved.cfg);
    return result?.ok === true ? NextResponse.json({ deleted: true }, { headers }) : failure(result);
  } catch (error) {
    console.error('[api/v1/social/workflows:DELETE] delete failed:', error instanceof SupabaseError ? error.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502, headers });
  }
}
