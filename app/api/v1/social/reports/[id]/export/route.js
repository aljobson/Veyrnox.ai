import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../../../lib/accountReadLimit.js';
import { socialReportExportsEnabled, socialReportsEnabled } from '../../../../../../../lib/social/publishFeature.js';
import { buildReportDocument } from '../../../../../../../lib/social/reportDocuments.js';
import { loadSocialReportData } from '../../../../../../../lib/social/reportData.js';
import { resolveBrand } from '../../../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req, { params }) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  const id = (await params).id;
  const format = new URL(req.url).searchParams.get('format') || 'pdf';
  if (!UUID.test(authId || '')) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  if (!socialReportsEnabled() || !socialReportExportsEnabled()) return NextResponse.json({ error: 'report_exports_not_open' }, { status: 404 });
  if (!UUID.test(id) || !['pdf', 'pptx'].includes(format)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  const limited = await accountReadLimit(authId, cfg, {}); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/reports/[id]/export:GET', { request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'] });
  if (brand.error) return brand.error;
  try {
    const listed = await rpc('list_social_report_templates', { p_auth_id: authId, p_brand_id: brand.brandId }, cfg);
    const template = listed?.ok && (listed.templates || []).find((item) => item.id === id);
    if (!template) return NextResponse.json({ error: 'report_not_found' }, { status: 404 });
    const data = await loadSocialReportData({ template, authId: brand.rpcAuthId, brandId: brand.brandId, cfg });
    if (!data.ok) return NextResponse.json({ error: data.error }, { status: 409 });
    const document = buildReportDocument(template, data, format);
    return new Response(document.bytes, { headers: { 'Content-Type': document.contentType,
      'Content-Disposition': `attachment; filename="${document.filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (err) {
    console.error('[api/v1/social/reports/export:GET] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}
