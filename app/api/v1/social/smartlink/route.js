import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { socialSmartLinksEnabled } from '../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;
const THEMES = new Set(['midnight', 'light', 'sunset']);

function setup(req) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!UUID.test(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
  if (!socialSmartLinksEnabled()) return { error: NextResponse.json({ error: 'smartlinks_not_open' }, { status: 404 }) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 }) };
  return { authId, cfg };
}

function mapResult(result) {
  if (result?.ok) return null;
  const code = result?.code;
  const status = code === 'PLAN_REQUIRED' ? 402 : code === 'BRAND_NOT_FOUND' ? 404 : code === 'SLUG_TAKEN' ? 409 : code?.startsWith('INVALID_') ? 400 : 502;
  return NextResponse.json({ error: code?.toLowerCase() || 'internal' }, { status });
}

export async function GET(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const limited = await accountReadLimit(authId, cfg, { smartlink: null, items: [], totals: { views: 0, clicks: 0 } }); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/smartlink:GET'); if (brand.error) return brand.error;
  try {
    const result = await rpc('get_social_smartlink_editor', { p_auth_id: authId, p_brand_id: brand.brandId }, cfg);
    return mapResult(result) || NextResponse.json({ brand_id: brand.brandId, smartlink: result.smartlink, items: result.items || [], totals: result.totals || { views: 0, clicks: 0 } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/v1/social/smartlink:GET] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}

export async function PUT(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const bio = typeof body?.bio === 'string' ? body.bio.trim() : '';
  const avatarUrl = typeof body?.avatarUrl === 'string' ? body.avatarUrl.trim() : '';
  const theme = body?.theme;
  const items = body?.items;
  if (!SLUG.test(slug) || !title || title.length > 80 || bio.length > 280 || !THEMES.has(theme) || typeof body?.published !== 'boolean' || !Array.isArray(items) || items.length > 20 ||
      items.some((item) => !item || typeof item.label !== 'string' || !item.label.trim() || item.label.trim().length > 60 || typeof item.url !== 'string' || !/^https:\/\//.test(item.url) || item.url.length > 1000 || typeof item.enabled !== 'boolean') ||
      (avatarUrl && (!/^https:\/\//.test(avatarUrl) || avatarUrl.length > 1000))) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/smartlink:PUT'); if (brand.error) return brand.error;
  try {
    const result = await rpc('save_social_smartlink', { p_auth_id: authId, p_brand_id: brand.brandId, p_slug: slug, p_title: title,
      p_bio: bio || null, p_avatar_url: avatarUrl || null, p_theme: theme, p_published: body.published,
      p_items: items.map((item) => ({ label: item.label.trim(), url: item.url, enabled: item.enabled })) }, cfg);
    return mapResult(result) || NextResponse.json({ smartlink_id: result.smartlink_id });
  } catch (err) {
    console.error('[api/v1/social/smartlink:PUT] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}
