import { socialCustomerApiEnabled } from './publishFeature.js';
import { envConfig, rpc, SupabaseError } from '../../packages/db/supabase-client.js';

const TOKEN = /^vxpub_[A-Za-z0-9_-]{43}$/;
const SCOPES = new Set(['accounts:read', 'posts:read', 'posts:write']);
export const customerApiHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function json(body, status, extra = {}) {
  return Response.json(body, { status, headers: { ...customerApiHeaders, ...extra } });
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function hashSocialCustomerApiKey(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function generateSocialCustomerApiKey() {
  const token = `vxpub_${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  return { token, prefix: token.slice(0, 15), hash: await hashSocialCustomerApiKey(token) };
}

export async function authenticateSocialCustomerApiRequest(req, scope, where) {
  if (!socialCustomerApiEnabled()) return { error: json({ error: 'not_found' }, 404) };
  if (!SCOPES.has(scope)) return { error: json({ error: 'internal' }, 500) };
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { error: json({ error: 'service_unavailable' }, 503) };
  const match = /^Bearer ([^\s]+)$/.exec(req.headers.get('authorization') || '');
  if (!match || !TOKEN.test(match[1])) return { error: json({ error: 'invalid_api_key' }, 401) };
  try {
    const result = await rpc('authenticate_social_api_key', { p_key_hash: await hashSocialCustomerApiKey(match[1]), p_scope: scope }, cfg);
    if (result?.ok === true) return { cfg, authId: result.auth_id, brandId: result.brand_id, keyId: result.key_id };
    if (result?.code === 'RATE_LIMITED') return { error: json({ error: 'rate_limited' }, 429, { 'Retry-After': String(result.retry_after_seconds || 60) }) };
    if (result?.code === 'PLAN_REQUIRED') return { error: json({ error: 'publish_plan_required' }, 402) };
    if (result?.code === 'INSUFFICIENT_SCOPE') return { error: json({ error: 'insufficient_scope' }, 403) };
    return { error: json({ error: 'invalid_api_key' }, 401) };
  } catch (error) {
    console.error(`[${where}] API key authentication failed:`, error instanceof SupabaseError ? error.status : 0);
    return { error: json({ error: 'service_unavailable' }, 503) };
  }
}
