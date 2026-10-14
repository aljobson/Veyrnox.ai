import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../../lib/accountReadLimit.js';
import { limitRequestBody } from '../../../../../../lib/requestBodyLimit.js';
import { generateSocialCustomerApiKey } from '../../../../../../lib/social/customerApiAuth.js';
import { socialCustomerApiEnabled } from '../../../../../../lib/social/publishFeature.js';
import { resolveBrand } from '../../../../../../lib/social/resolveBrand.js';
import { socialPostWriteLimit } from '../../../../../../lib/socialPostWriteLimit.js';
import { envConfig, rpc, SupabaseError } from '../../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_SCOPES = new Set(['accounts:read', 'posts:read', 'posts:write']);
const EXPIRY_DAYS = new Set([30, 90, 365]);

function setup(req) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!UUID.test(authId || '')) return { error: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
  if (!socialCustomerApiEnabled()) return { error: NextResponse.json({ error: 'customer_api_not_open' }, { status: 404 }) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 }) };
  return { authId, cfg };
}

function mapped(result) {
  if (result?.ok) return null;
  const code = result?.code || 'INTERNAL';
  const status = code === 'PLAN_REQUIRED' ? 402 : code === 'FORBIDDEN' ? 403
    : ['BRAND_NOT_FOUND', 'API_KEY_NOT_FOUND'].includes(code) ? 404
      : ['API_KEY_LIMIT', 'KEY_COLLISION'].includes(code) ? 409
        : code === 'INVALID_INPUT' ? 400 : 502;
  return NextResponse.json({ error: status === 502 ? 'internal' : code.toLowerCase() }, { status });
}

export async function GET(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const limited = await accountReadLimit(authId, cfg, { keys: [] }); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/developer/keys:GET', { request: req, allowedRoles: ['owner', 'manager'] });
  if (brand.error) return brand.error;
  try {
    const result = await rpc('list_social_api_keys', { p_auth_id: authId, p_brand_id: brand.brandId }, cfg);
    return mapped(result) || NextResponse.json({ keys: result.keys || [], brandRole: brand.role }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/v1/social/developer/keys:GET] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}

export async function POST(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const limitedBody = await limitRequestBody(req); if (limitedBody.response) return limitedBody.response;
  let body; try { body = await limitedBody.request.json(); } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }); }
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  const scopes = Array.isArray(body?.scopes) ? [...new Set(body.scopes)] : [];
  const expiresInDays = Number(body?.expiresInDays);
  if (!label || label.length > 80 || scopes.length < 1 || scopes.length > 3 || scopes.some((scope) => !ALLOWED_SCOPES.has(scope)) || !EXPIRY_DAYS.has(expiresInDays)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/developer/keys:POST', { request: req, allowedRoles: ['owner', 'manager'] });
  if (brand.error) return brand.error;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const key = await generateSocialCustomerApiKey();
    try {
      const result = await rpc('create_social_api_key', { p_auth_id: authId, p_brand_id: brand.brandId, p_label: label,
        p_key_prefix: key.prefix, p_key_hash: key.hash, p_scopes: scopes,
        p_expires_at: new Date(Date.now() + expiresInDays * 86_400_000).toISOString() }, cfg);
      if (result?.code === 'KEY_COLLISION' && attempt === 0) continue;
      const response = mapped(result); if (response) return response;
      return NextResponse.json({ key_id: result.key_id, api_key: key.token,
        warning: 'Copy this key now. For your security, it will not be shown again.' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      console.error('[api/v1/social/developer/keys:POST] failed:', err instanceof SupabaseError ? err.status : 0);
      return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
  }
  return NextResponse.json({ error: 'key_collision' }, { status: 409 });
}

export async function DELETE(req) {
  const { authId, cfg, error } = setup(req); if (error) return error;
  const id = new URL(req.url).searchParams.get('id');
  if (!UUID.test(id || '')) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const limited = await socialPostWriteLimit(authId, cfg); if (limited) return limited;
  const brand = await resolveBrand(authId, cfg, 'api/v1/social/developer/keys:DELETE', { request: req, allowedRoles: ['owner', 'manager'] });
  if (brand.error) return brand.error;
  try {
    const result = await rpc('revoke_social_api_key', { p_auth_id: authId, p_brand_id: brand.brandId, p_key_id: id }, cfg);
    return mapped(result) || NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/v1/social/developer/keys:DELETE] failed:', err instanceof SupabaseError ? err.status : 0);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
  }
}
