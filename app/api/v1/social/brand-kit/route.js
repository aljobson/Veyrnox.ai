// The workspace brand kit linked to the caller's selected Publish brand
// (ADR-0325, migration 0441). GET: any brand member reads the presentation
// part of the kit. PUT: only the brand owner links or unlinks a workspace
// they can edit. The RPCs re-check roles from the verified acting id.
import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

import { isUuidLoose } from '../../../../../lib/validate.js';
const ALL_ROLES = ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'];

function setup(req) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!isUuidLoose(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
  // The kit lives behind the editor's shared-tools switch; no kit, nothing to link.
  if (process.env.EDITOR_SHARED_TOOLS_ENABLED !== 'true') return { error: NextResponse.json({ error: 'brand_kit_not_open' }, { status: 404 }) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 }) };
  return { authId, cfg };
}

function mapResult(result) {
  if (result?.ok) return null;
  const code = result?.code;
  const status = code === 'USER_NOT_FOUND' ? 401
    : code === 'FORBIDDEN' ? 403
    : ['BRAND_NOT_FOUND', 'WORKSPACE_NOT_FOUND'].includes(code) ? 404 : 502;
  return NextResponse.json({ error: ['USER_NOT_FOUND', 'FORBIDDEN', 'BRAND_NOT_FOUND', 'WORKSPACE_NOT_FOUND'].includes(code) ? code.toLowerCase() : 'internal' }, { status });
}

export async function GET(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const limited = await accountReadLimit(authId, cfg, { linked: false }); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/brand-kit:GET', { request: req, allowedRoles: ALL_ROLES }); if (brand.error) return brand.error;
  try {
    const result = await rpc('get_social_brand_kit', { p_auth_id: authId, p_brand_id: brand.brandId }, cfg);
    if (!result?.ok) return mapResult(result);
    const { ok: _ok, ...kit } = result;
    return NextResponse.json(kit, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/v1/social/brand-kit:GET] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}

export async function PUT(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
  const workspaceId = body?.workspaceId;
  if (keys.length !== 1 || keys[0] !== 'workspaceId' || (workspaceId !== null && (typeof workspaceId !== 'string' || !isUuidLoose(workspaceId)))) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/brand-kit:PUT', { request: req, allowedRoles: ['owner'] }); if (brand.error) return brand.error;
  try {
    const result = await rpc('set_social_brand_kit_link', { p_auth_id: authId, p_brand_id: brand.brandId, p_workspace_id: workspaceId }, cfg);
    return mapResult(result) || NextResponse.json({ linked: result.linked === true });
  } catch (err) {
    console.error('[api/v1/social/brand-kit:PUT] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}
