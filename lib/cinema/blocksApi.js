import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const USERNAME = /^[a-z][a-z0-9_]{2,29}$/;
const errors = {
  account_not_found: 403,
  user_not_found: 404,
  cannot_block_self: 400,
  invalid_username: 400,
  block_limit: 409,
};

/**
 * Block list for the signed-in person (ADR-0135). `action` is 'list' (GET),
 * 'block' (POST {username}) or 'unblock' (DELETE /:username). Block and
 * unblock are idempotent by key: a replay answers 200 with already:true.
 */
export function blocksHandler({ action = 'list', rpcCall = rpc } = {}) {
  if (!['list', 'block', 'unblock'].includes(action)) throw Error('invalid blocks action');
  return async (req, ctx) => {
    const requestId = crypto.randomUUID();
    const auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200) => {
      console.info(JSON.stringify({ event: 'cinema.blocks', request_id: requestId, actor_id: UUID.test(auth || '') ? auth : undefined, action, status, code: body.error || 'ok' }));
      return Response.json({ ...body, request_id: requestId }, {
        status,
        headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId, ...(status === 429 ? { 'Retry-After': '60' } : {}) },
      });
    };
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (!cinemaFeatures(process.env).viewing) return reply({ error: 'viewing_not_open' }, 503);
    try {
      if (new URL(req.url).searchParams.size) return reply({ error: 'invalid_query' }, 400);
      let username = null;
      if (action === 'block') {
        if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
        const body = await limited.request.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'username')
          || typeof body.username !== 'string' || !USERNAME.test(body.username)) return reply({ error: 'invalid_body' }, 400);
        username = body.username;
      } else if (action === 'unblock') {
        const params = ctx && ctx.params ? await ctx.params : {};
        username = String(params.username || '');
        if (!USERNAME.test(username)) return reply({ error: 'invalid_username' }, 400);
      }
      const cfg = envConfig();
      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, cfg);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited' }, 429);
      if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
      const [name, args] = action === 'list'
        ? ['list_blocked_cinema_users', { p_auth_id: auth }]
        : [action === 'block' ? 'block_cinema_user' : 'unblock_cinema_user', { p_auth_id: auth, p_username: username }];
      const result = await rpcCall(name, args, cfg);
      if (result?.error) return reply({ error: errors[result.error] ? result.error : 'temporarily_unavailable' }, errors[result.error] || 503);
      if (action === 'list') {
        if (!Array.isArray(result?.blocks)) return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({
          blocks: result.blocks.filter((b) => USERNAME.test(b?.username || '')).map((b) => ({ username: b.username, display_name: b.display_name, created_at: b.created_at })),
        });
      }
      if (result?.ok !== true || typeof result.already !== 'boolean') return reply({ error: 'temporarily_unavailable' }, 503);
      return reply({ username, blocked: action === 'block', already: result.already }, result.already || action === 'unblock' ? 200 : 201);
    } catch {
      return reply({ error: 'temporarily_unavailable' }, 503);
    }
  };
}

/** Usernames the signed-in person has blocked, or null when the lookup fails. */
export async function blockedUsernames(auth, cfg, rpcCall = rpc) {
  const result = await rpcCall('list_blocked_cinema_users', { p_auth_id: auth }, cfg);
  return Array.isArray(result?.blocks) ? new Set(result.blocks.map((b) => b.username)) : null;
}
