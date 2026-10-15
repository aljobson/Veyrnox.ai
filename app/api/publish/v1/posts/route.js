import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';
import { authenticateSocialCustomerApiRequest, socialCustomerApiResponse } from '../../../../../lib/social/customerApiAuth.js';
import { postCapabilityError } from '../../../../../lib/social/postCapabilities.js';
import { socialUploadsEnabled } from '../../../../../lib/social/uploadPolicy.js';
import { rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_TYPES = new Set(['image', 'video']);
const BODY_KEYS = new Set(['scheduledAt', 'publishNow', 'text', 'idempotencyKey', 'accountIds', 'media']);
const isUuid = (value) => typeof value === 'string' && UUID.test(value);
const reply = (authenticated, body, status = 200, error = null) => socialCustomerApiResponse(authenticated, body, status, error);

export async function GET(req) {
  const authenticated = await authenticateSocialCustomerApiRequest(req, 'posts:read', 'api/publish/v1/posts:GET', '/api/publish/v1/posts');
  if (authenticated.error) return authenticated.error;
  const url = new URL(req.url);
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 24;
  const beforeCreatedAt = url.searchParams.get('before_created_at');
  const beforeId = url.searchParams.get('before_id');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return reply(authenticated, { error: 'invalid_limit' }, 400, 'invalid_limit');
  if (beforeId && !isUuid(beforeId)) return reply(authenticated, { error: 'invalid_cursor' }, 400, 'invalid_cursor');
  if (beforeCreatedAt && Number.isNaN(Date.parse(beforeCreatedAt))) return reply(authenticated, { error: 'invalid_cursor' }, 400, 'invalid_cursor');
  try {
    const result = await rpc('list_social_posts', { p_auth_id: authenticated.authId, p_brand_id: authenticated.brandId,
      p_limit: limit, p_before_created_at: beforeCreatedAt || null, p_before_id: beforeId || null }, authenticated.cfg);
    return result?.ok ? reply(authenticated, { data: result.posts || [] }) : reply(authenticated, { error: 'service_unavailable' }, 503, 'service_unavailable');
  } catch (error) {
    console.error('[api/publish/v1/posts:GET] failed:', error instanceof SupabaseError ? error.status : 0);
    return reply(authenticated, { error: 'service_unavailable' }, 503, 'service_unavailable');
  }
}

export async function POST(req) {
  const authenticated = await authenticateSocialCustomerApiRequest(req, 'posts:write', 'api/publish/v1/posts:POST', '/api/publish/v1/posts');
  if (authenticated.error) return authenticated.error;
  const limited = await limitRequestBody(req); if (limited.response) {
    const body = await limited.response.clone().json();
    return reply(authenticated, body, limited.response.status, body.error);
  }
  let body; try { body = await limited.request.json(); } catch { return reply(authenticated, { error: 'invalid_body' }, 400, 'invalid_body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !BODY_KEYS.has(key))) return reply(authenticated, { error: 'invalid_body' }, 400, 'invalid_body');
  if (body.publishNow !== undefined && typeof body.publishNow !== 'boolean') return reply(authenticated, { error: 'invalid_publish_now' }, 400, 'invalid_publish_now');
  const scheduledAt = body.publishNow === true ? new Date().toISOString() : body.scheduledAt;
  if (typeof scheduledAt !== 'string' || Number.isNaN(Date.parse(scheduledAt))) return reply(authenticated, { error: 'invalid_schedule' }, 400, 'invalid_schedule');
  if (body.text != null && (typeof body.text !== 'string' || body.text.length > 4000)) return reply(authenticated, { error: 'invalid_text' }, 400, 'invalid_text');
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.idempotencyKey)) return reply(authenticated, { error: 'invalid_idempotency_key' }, 400, 'invalid_idempotency_key');
  if (!Array.isArray(body.accountIds) || body.accountIds.length < 1 || body.accountIds.length > 20 || !body.accountIds.every(isUuid)
    || new Set(body.accountIds).size !== body.accountIds.length) return reply(authenticated, { error: 'invalid_account_ids' }, 400, 'invalid_account_ids');
  if (!Array.isArray(body.media) || body.media.length < 1 || body.media.length > 10) return reply(authenticated, { error: 'invalid_media' }, 400, 'invalid_media');
  const media=[];
  for (const item of body.media) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key)=>!['mediaType','jobId','uploadId'].includes(key))
      || !MEDIA_TYPES.has(item.mediaType) || (Boolean(item.jobId) === Boolean(item.uploadId))
      || (item.jobId ? !isUuid(item.jobId) : !isUuid(item.uploadId) || !socialUploadsEnabled(process.env, authenticated.authId))) return reply(authenticated, { error: 'invalid_media' }, 400, 'invalid_media');
    media.push({ media_type: item.mediaType, ...(item.jobId ? { job_id: item.jobId } : { upload_id: item.uploadId }) });
  }
  try {
    const listed = await rpc('list_social_accounts', { p_auth_id: authenticated.authId, p_brand_id: authenticated.brandId }, authenticated.cfg);
    if (!listed?.ok || !Array.isArray(listed.accounts)) return reply(authenticated, { error: 'service_unavailable' }, 503, 'service_unavailable');
    const destinations = listed.accounts.filter((account) => body.accountIds.includes(account.id) && account.status === 'active');
    if (destinations.length !== body.accountIds.length) return reply(authenticated, { error: 'account_not_found' }, 404, 'account_not_found');
    const capabilityError = postCapabilityError(destinations, media, body.text || '', process.env, authenticated.authId);
    if (capabilityError) return reply(authenticated, { error: capabilityError }, 400, capabilityError);
    const result = await rpc('create_social_post', { p_auth_id: authenticated.authId, p_brand_id: authenticated.brandId,
      p_scheduled_at: scheduledAt, p_global_text: body.text || null, p_idempotency_key: body.idempotencyKey,
      p_account_ids: body.accountIds, p_media: media }, authenticated.cfg);
    if (!result?.ok) {
      const code=result?.code||'INTERNAL';
      const status=code==='FORBIDDEN'?403:code==='PLAN_REQUIRED'?402:['ACCOUNT_NOT_FOUND','MEDIA_NOT_FOUND'].includes(code)?404:code.startsWith('INVALID_')?400:503;
      const error=status===503?'service_unavailable':code.toLowerCase();return reply(authenticated, { error }, status, error);
    }
    return reply(authenticated, { data: { id: result.post_id, status: 'scheduled', idempotent: result.idempotent, target_count: result.target_count || 0 } }, 201);
  } catch (error) {
    console.error('[api/publish/v1/posts:POST] failed:', error instanceof SupabaseError ? error.status : 0);
    return reply(authenticated, { error: 'service_unavailable' }, 503, 'service_unavailable');
  }
}
