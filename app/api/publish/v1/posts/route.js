import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';
import { authenticateSocialCustomerApiRequest, customerApiHeaders } from '../../../../../lib/social/customerApiAuth.js';
import { postCapabilityError } from '../../../../../lib/social/postCapabilities.js';
import { socialUploadsEnabled } from '../../../../../lib/social/uploadPolicy.js';
import { rpc, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_TYPES = new Set(['image', 'video']);
const BODY_KEYS = new Set(['scheduledAt', 'publishNow', 'text', 'idempotencyKey', 'accountIds', 'media']);
const isUuid = (value) => typeof value === 'string' && UUID.test(value);
const reply = (body, status = 200) => Response.json(body, { status, headers: customerApiHeaders });

export async function GET(req) {
  const authenticated = await authenticateSocialCustomerApiRequest(req, 'posts:read', 'api/publish/v1/posts:GET');
  if (authenticated.error) return authenticated.error;
  const url = new URL(req.url);
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 24;
  const beforeCreatedAt = url.searchParams.get('before_created_at');
  const beforeId = url.searchParams.get('before_id');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return reply({ error: 'invalid_limit' }, 400);
  if (beforeId && !isUuid(beforeId)) return reply({ error: 'invalid_cursor' }, 400);
  if (beforeCreatedAt && Number.isNaN(Date.parse(beforeCreatedAt))) return reply({ error: 'invalid_cursor' }, 400);
  try {
    const result = await rpc('list_social_posts', { p_auth_id: authenticated.authId, p_brand_id: authenticated.brandId,
      p_limit: limit, p_before_created_at: beforeCreatedAt || null, p_before_id: beforeId || null }, authenticated.cfg);
    return result?.ok ? reply({ data: result.posts || [] }) : reply({ error: 'service_unavailable' }, 503);
  } catch (error) {
    console.error('[api/publish/v1/posts:GET] failed:', error instanceof SupabaseError ? error.status : 0);
    return reply({ error: 'service_unavailable' }, 503);
  }
}

export async function POST(req) {
  const authenticated = await authenticateSocialCustomerApiRequest(req, 'posts:write', 'api/publish/v1/posts:POST');
  if (authenticated.error) return authenticated.error;
  const limited = await limitRequestBody(req); if (limited.response) return limited.response;
  let body; try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !BODY_KEYS.has(key))) return reply({ error: 'invalid_body' }, 400);
  if (body.publishNow !== undefined && typeof body.publishNow !== 'boolean') return reply({ error: 'invalid_publish_now' }, 400);
  const scheduledAt = body.publishNow === true ? new Date().toISOString() : body.scheduledAt;
  if (typeof scheduledAt !== 'string' || Number.isNaN(Date.parse(scheduledAt))) return reply({ error: 'invalid_schedule' }, 400);
  if (body.text != null && (typeof body.text !== 'string' || body.text.length > 4000)) return reply({ error: 'invalid_text' }, 400);
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.idempotencyKey)) return reply({ error: 'invalid_idempotency_key' }, 400);
  if (!Array.isArray(body.accountIds) || body.accountIds.length < 1 || body.accountIds.length > 20 || !body.accountIds.every(isUuid)
    || new Set(body.accountIds).size !== body.accountIds.length) return reply({ error: 'invalid_account_ids' }, 400);
  if (!Array.isArray(body.media) || body.media.length < 1 || body.media.length > 10) return reply({ error: 'invalid_media' }, 400);
  const media=[];
  for (const item of body.media) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key)=>!['mediaType','jobId','uploadId'].includes(key))
      || !MEDIA_TYPES.has(item.mediaType) || (Boolean(item.jobId) === Boolean(item.uploadId))
      || (item.jobId ? !isUuid(item.jobId) : !isUuid(item.uploadId) || !socialUploadsEnabled(process.env, authenticated.authId))) return reply({ error: 'invalid_media' }, 400);
    media.push({ media_type: item.mediaType, ...(item.jobId ? { job_id: item.jobId } : { upload_id: item.uploadId }) });
  }
  try {
    const listed = await rpc('list_social_accounts', { p_auth_id: authenticated.authId, p_brand_id: authenticated.brandId }, authenticated.cfg);
    if (!listed?.ok || !Array.isArray(listed.accounts)) return reply({ error: 'service_unavailable' }, 503);
    const destinations = listed.accounts.filter((account) => body.accountIds.includes(account.id) && account.status === 'active');
    if (destinations.length !== body.accountIds.length) return reply({ error: 'account_not_found' }, 404);
    const capabilityError = postCapabilityError(destinations, media, body.text || '', process.env, authenticated.authId);
    if (capabilityError) return reply({ error: capabilityError }, 400);
    const result = await rpc('create_social_post', { p_auth_id: authenticated.authId, p_brand_id: authenticated.brandId,
      p_scheduled_at: scheduledAt, p_global_text: body.text || null, p_idempotency_key: body.idempotencyKey,
      p_account_ids: body.accountIds, p_media: media }, authenticated.cfg);
    if (!result?.ok) {
      const code=result?.code||'INTERNAL';
      const status=code==='FORBIDDEN'?403:code==='PLAN_REQUIRED'?402:['ACCOUNT_NOT_FOUND','MEDIA_NOT_FOUND'].includes(code)?404:code.startsWith('INVALID_')?400:503;
      return reply({ error: status===503?'service_unavailable':code.toLowerCase() }, status);
    }
    return reply({ data: { id: result.post_id, status: 'scheduled', idempotent: result.idempotent, target_count: result.target_count || 0 } }, 201);
  } catch (error) {
    console.error('[api/publish/v1/posts:POST] failed:', error instanceof SupabaseError ? error.status : 0);
    return reply({ error: 'service_unavailable' }, 503);
  }
}
