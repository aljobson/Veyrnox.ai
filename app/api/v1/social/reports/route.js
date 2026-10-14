import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { socialReportsEnabled } from '../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGES = new Set([7, 30, 90, 365]);
const COLOR = /^#[0-9a-f]{6}$/i;

function setup(req) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!UUID.test(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
  if (!socialReportsEnabled()) return { error: NextResponse.json({ error: 'reports_not_open' }, { status: 404 }) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 }) };
  return { authId, cfg };
}

function mapped(result) {
  if (result?.ok) return null;
  const code = result?.code;
  const status = code === 'PLAN_REQUIRED' ? 402 : code === 'FORBIDDEN' ? 403
    : ['BRAND_NOT_FOUND', 'REPORT_NOT_FOUND'].includes(code) ? 404
      : ['REPORT_NAME_TAKEN', 'REPORT_LIMIT'].includes(code) ? 409
        : code?.startsWith('INVALID_') ? 400 : 502;
  return NextResponse.json({ error: status === 502 ? 'internal' : code.toLowerCase() }, { status });
}

export async function GET(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const limited = await accountReadLimit(authId, cfg, { templates: [] }); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/reports:GET', { request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'] }); if (brand.error) return brand.error;
  try {
    const result = await rpc('list_social_report_templates', { p_auth_id: authId, p_brand_id: brand.brandId }, cfg);
    return mapped(result) || NextResponse.json({ templates: result.templates || [], brandRole: brand.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/v1/social/reports:GET] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}

export async function PUT(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  const id = body?.id == null ? null : body.id;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const accountId = body?.accountId == null || body.accountId === '' ? null : body.accountId;
  const reportTitle = typeof body?.reportTitle === 'string' ? body.reportTitle.trim() : '';
  const accentColor = typeof body?.accentColor === 'string' ? body.accentColor.toLowerCase() : '';
  if ((id !== null && !UUID.test(id)) || !name || name.length > 80 || (accountId !== null && !UUID.test(accountId))
    || !RANGES.has(body?.rangeDays) || typeof body?.comparePrevious !== 'boolean' || typeof body?.includeContent !== 'boolean'
    || reportTitle.length > 100 || !COLOR.test(accentColor)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/reports:PUT', { request: req, allowedRoles: ['owner', 'manager', 'editor', 'analyst'] }); if (brand.error) return brand.error;
  try {
    const result = await rpc('save_social_report_template', { p_auth_id: authId, p_brand_id: brand.brandId, p_id: id, p_name: name,
      p_account_id: accountId, p_range_days: body.rangeDays, p_compare_previous: body.comparePrevious,
      p_include_content: body.includeContent, p_report_title: reportTitle || null, p_accent_color: accentColor }, cfg);
    return mapped(result) || NextResponse.json({ template_id: result.template_id });
  } catch (err) {
    console.error('[api/v1/social/reports:PUT] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}

export async function DELETE(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const id = new URL(req.url).searchParams.get('id');
  if (!UUID.test(id || '')) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/reports:DELETE', { request: req, allowedRoles: ['owner', 'manager', 'editor', 'analyst'] }); if (brand.error) return brand.error;
  try {
    const result = await rpc('delete_social_report_template', { p_auth_id: authId, p_brand_id: brand.brandId, p_id: id }, cfg);
    return mapped(result) || NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/v1/social/reports:DELETE] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}
