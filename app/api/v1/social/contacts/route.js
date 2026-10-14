import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { socialPostWriteLimit } from '../../../../../lib/socialPostWriteLimit.js';
import { publishPlansEnabled, socialInboxEnabled } from '../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { envConfig, rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NETWORKS = new Set(['instagram', 'facebook', 'twitter', 'linkedin', 'tiktok', 'youtube', 'threads', 'bluesky', 'twitch', 'gmb']);
const STATUSES = new Set(['unknown', 'subscribed', 'unsubscribed']);
const TAG = /^[a-z0-9][a-z0-9 _-]*$/;
const headers = { 'Cache-Control': 'no-store' };

function setup(req) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!UUID.test(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers }) };
  if (!socialInboxEnabled() || !publishPlansEnabled()) return { error: NextResponse.json({ error: 'publish_inbox_not_open' }, { status: 503, headers }) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503, headers }) };
  return { authId, cfg };
}

function mapped(result) {
  if (result?.ok) return null;
  const code = result?.code;
  const status = code === 'PLAN_REQUIRED' ? 402 : code === 'FORBIDDEN' ? 403
    : ['BRAND_NOT_FOUND', 'ACCOUNT_NOT_FOUND', 'CONTACT_NOT_FOUND'].includes(code) ? 404
      : code?.startsWith('INVALID_') ? 400 : 502;
  return NextResponse.json({ error: status === 502 ? 'internal' : code.toLowerCase() }, { status, headers });
}

export async function GET(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const url = new URL(req.url);
  const accountId = url.searchParams.get('accountId') || null;
  const network = url.searchParams.get('network') || null;
  const subscriptionStatus = url.searchParams.get('subscriptionStatus') || null;
  const search = url.searchParams.get('search')?.trim() || null;
  const tag = url.searchParams.get('tag')?.trim().toLowerCase() || null;
  if ((accountId && !UUID.test(accountId)) || (network && !NETWORKS.has(network))
    || (subscriptionStatus && !STATUSES.has(subscriptionStatus)) || (search && search.length > 100)
    || (tag && (tag.length > 32 || !TAG.test(tag)))) return NextResponse.json({ error: 'invalid_filter' }, { status: 400, headers });
  const limited = await accountReadLimit(authId, cfg, { contacts: [] }); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/contacts:GET', {
    request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'],
  }); if (brand.error) return brand.error;
  try {
    const result = await rpc('list_social_inbox_contacts', { p_auth_id: authId, p_brand_id: brand.brandId,
      p_account_id: accountId, p_network: network, p_subscription_status: subscriptionStatus,
      p_search: search, p_tag: tag }, cfg);
    return mapped(result) || NextResponse.json({ contacts: result.contacts || [], brandRole: brand.role }, { headers });
  } catch (err) {
    console.error('[api/v1/social/contacts:GET] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502, headers });
  }
}

export async function PATCH(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers }); }
  const accountId = body?.accountId;
  const externalId = typeof body?.externalId === 'string' ? body.externalId.trim() : '';
  const tags = Array.isArray(body?.tags) ? [...new Set(body.tags.map((value) => typeof value === 'string' ? value.trim().toLowerCase() : ''))] : null;
  const subscriptionStatus = body?.subscriptionStatus;
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
  if (!UUID.test(accountId || '') || !externalId || externalId.length > 256 || !STATUSES.has(subscriptionStatus)
    || !tags || tags.length > 10 || tags.some((tag) => !tag || tag.length > 32 || !TAG.test(tag)) || notes.length > 2000) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers });
  }
  const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/contacts:PATCH', {
    request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer'],
  }); if (brand.error) return brand.error;
  try {
    const result = await rpc('update_social_inbox_contact', { p_auth_id: authId, p_brand_id: brand.brandId,
      p_account_id: accountId, p_external_id: externalId, p_tags: tags,
      p_subscription_status: subscriptionStatus, p_notes: notes || null }, cfg);
    return mapped(result) || NextResponse.json({ ok: true, tags: result.tags || [], subscriptionStatus: result.subscription_status }, { headers });
  } catch (err) {
    console.error('[api/v1/social/contacts:PATCH] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502, headers });
  }
}
