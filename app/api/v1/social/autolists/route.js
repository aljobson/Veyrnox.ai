import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { socialQueuesEnabled, socialRssAutolistsEnabled } from '../../../../../lib/social/publishFeature.js';
import { safeFeedUrl } from '../../../../../lib/social/rssFeed.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERVALS = new Set([30, 60, 180, 360, 720, 1440]);
function setup(req) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!UUID.test(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
  if (!socialRssAutolistsEnabled() || !socialQueuesEnabled()) return { error: NextResponse.json({ error: 'autolists_not_open' }, { status: 404 }) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 }) };
  return { authId, cfg };
}
function mapped(result) {
  if (result?.ok) return null;
  const code = result?.code;
  const status = code === 'PLAN_REQUIRED' ? 402 : code === 'FORBIDDEN' ? 403
    : ['BRAND_NOT_FOUND', 'AUTOLIST_NOT_FOUND'].includes(code) ? 404
      : ['AUTOLIST_NAME_TAKEN', 'AUTOLIST_LIMIT'].includes(code) ? 409
        : code?.startsWith('INVALID_') ? 400 : 502;
  return NextResponse.json({ error: code?.toLowerCase() || 'internal' }, { status });
}
function validTemplate(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 4000) return false;
  return !value.replaceAll('{{title}}', '').replaceAll('{{link}}', '').replaceAll('{{summary}}', '').match(/\{\{[^}]+\}\}/);
}

export async function GET(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const limited = await accountReadLimit(authId, cfg, { autolists: [] }); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/autolists:GET', { request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'] });
  if (brand.error) return brand.error;
  try {
    const result = await rpc('list_social_publish_autolists', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId }, cfg);
    return mapped(result) || NextResponse.json({ autolists: result.autolists || [], brandRole: brand.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/v1/social/autolists:GET] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}

export async function PUT(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  const id = body?.id == null ? null : body.id;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const captionTemplate = typeof body?.captionTemplate === 'string' ? body.captionTemplate.trim() : '';
  const feedUrl = safeFeedUrl(body?.feedUrl);
  if ((id !== null && !UUID.test(id)) || !UUID.test(body?.queueId || '') || !name || name.length > 80 || !feedUrl
    || !validTemplate(captionTemplate) || !INTERVALS.has(body?.refreshIntervalMinutes)
    || typeof body?.enabled !== 'boolean' || typeof body?.autoSchedule !== 'boolean') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/autolists:PUT', { request: req, allowedRoles: ['owner', 'manager', 'editor'] });
  if (brand.error) return brand.error;
  try {
    const result = await rpc('save_social_publish_autolist', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId, p_id: id,
      p_queue_id: body.queueId, p_name: name, p_feed_url: feedUrl, p_caption_template: captionTemplate,
      p_refresh_interval_minutes: body.refreshIntervalMinutes, p_enabled: body.enabled, p_auto_schedule: body.autoSchedule }, cfg);
    return mapped(result) || NextResponse.json({ autolist_id: result.autolist_id });
  } catch (err) {
    console.error('[api/v1/social/autolists:PUT] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}

export async function DELETE(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const id = new URL(req.url).searchParams.get('id');
  if (!UUID.test(id || '')) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/autolists:DELETE', { request: req, allowedRoles: ['owner', 'manager', 'editor'] });
  if (brand.error) return brand.error;
  try {
    const result = await rpc('delete_social_publish_autolist', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId, p_id: id }, cfg);
    return mapped(result) || NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/v1/social/autolists:DELETE] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}
