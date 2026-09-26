import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { cinemaFeatures } from '../../../../../lib/cinema/features.js';
import { limitRequestBody } from '../../../../../lib/requestBodyLimit.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});
const codes = { account_not_active: 403, invalid_profile: 400, user_not_provisioned: 409, username_unavailable: 409,
  profile_exists: 409, idempotency_conflict: 409 };

async function handle(req, create) {
  const authId = req.headers.get('x-veyrnox-auth-id');
  if (!UUID.test(authId || '')) return reply({ error: 'not_authenticated' }, 401);
  if (!cinemaFeatures(process.env).profiles) {
    return reply({ error: 'profiles_not_open' }, 503);
  }
  const cfg = envConfig();
  try {
    // Share the existing durable account-request bucket; fail closed even if
    // account read limiting is disabled elsewhere. No new schema is required.
    const rate = await rpc('consume_account_read_request', { p_auth_id: authId }, cfg);
    if (rate?.code === 'RATE_LIMITED') {
      const seconds = Number.isInteger(rate.retry_after_seconds)
        ? Math.max(1, Math.min(60, rate.retry_after_seconds)) : 60;
      return reply({ error: 'rate_limited' }, 429, { 'Retry-After': String(seconds) });
    }
    if (rate?.code === 'NOT_FOUND') return reply({ error: 'user_not_provisioned' }, 409);
    if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
    if (!create) {
      const profile = await rpc('read_own_cinema_profile', { p_auth_id: authId }, cfg);
      if (profile?.error === 'account_not_active') return reply({ error: 'account_not_active' }, 403);
      return reply({ profile });
    }
    const key = req.headers.get('idempotency-key');
    if (!UUID.test(key || '')) return reply({ error: 'invalid_idempotency_key' }, 400);
    if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      return reply({ error: 'invalid_content_type' }, 415);
    }
    const limited = await limitRequestBody(req);
    if (limited.response) return limited.response;
    let body;
    try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_profile' }, 400); }
    if (!body || Array.isArray(body) || typeof body !== 'object'
      || Object.keys(body).some(k => !['username', 'display_name', 'bio'].includes(k))
      || typeof body.username !== 'string' || !/^[a-z][a-z0-9_]{2,29}$/.test(body.username)
      || typeof body.display_name !== 'string' || !body.display_name.trim()
      || [...body.display_name.trim()].length > 80
      || (body.bio !== undefined && (typeof body.bio !== 'string' || [...body.bio].length > 500))) {
      return reply({ error: 'invalid_profile' }, 400);
    }
    const result = await rpc('create_cinema_profile', {
      p_auth_id: authId, p_idempotency_key: key,
      p_profile: { username: body.username, display_name: body.display_name.trim(), bio: body.bio || '' },
    }, cfg);
    if (result?.error && Object.hasOwn(codes, result.error)) return reply({ error: result.error }, codes[result.error]);
    if (!UUID.test(result?.profile_id || '')) return reply({ error: 'temporarily_unavailable' }, 503);
    return reply({ profile_id: result.profile_id, idempotent: result.idempotent === true }, result.idempotent ? 200 : 201);
  } catch {
    console.error('[social-cinema] profile request failed');
    return reply({ error: 'temporarily_unavailable' }, 503);
  }
}
export const GET = req => handle(req, false);
export const POST = req => handle(req, true);
