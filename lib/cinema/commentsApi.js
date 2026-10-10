import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { verifyAccessLogin } from '../accessJwt.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const length = (v, min, max) =>
  typeof v === 'string' &&
  [...v.trim()].length >= min &&
  [...v.trim()].length <= max;
const allowed = (b, keys) =>
  b &&
  typeof b === 'object' &&
  !Array.isArray(b) &&
  Object.keys(b).every((k) => keys.includes(k));
const categories = ['spam', 'abuse', 'privacy', 'rights', 'other'];
const states = ['pending', 'approved', 'rejected', 'removed', 'withdrawn'];
const errors = {
  profile_required: 403,
  account_not_active: 403,
  not_authorized: 403,
  self_review_forbidden: 403,
  self_report_forbidden: 403,
  content_not_found: 404,
  comment_not_found: 404,
  report_not_found: 404,
  invalid_comment: 400,
  invalid_report: 400,
  invalid_action: 400,
  invalid_cursor: 400,
  idempotency_conflict: 409,
  already_reviewed: 409,
  pending_limit: 429,
  rate_limited: 429,
};
export function validCommentMutation(b) {
  if (!b) return false;
  if (b.action === 'submit')
    return (
      allowed(b, ['action', 'content_id', 'body']) &&
      UUID.test(b.content_id || '') &&
      length(b.body, 1, 2000)
    );
  if (b.action === 'withdraw')
    return (
      allowed(b, ['action', 'comment_id']) && UUID.test(b.comment_id || '')
    );
  if (b.action === 'report')
    return (
      allowed(b, ['action', 'comment_id', 'category', 'details']) &&
      UUID.test(b.comment_id || '') &&
      categories.includes(b.category) &&
      length(b.details, 3, 500)
    );
  return false;
}
export function validCommentDecision(b) {
  return (
    allowed(b, ['action', 'id', 'decision', 'reason']) &&
    UUID.test(b.id || '') &&
    length(b.reason, 3, 500) &&
    (b.action === 'review_comment'
      ? ['approved', 'rejected', 'removed'].includes(b.decision)
      : b.action === 'resolve_report' && !Object.hasOwn(b, 'decision'))
  );
}
export function commentsHandler({
  action = 'read',
  authed = true,
  rpcCall = rpc,
  accessVerifier = verifyAccessLogin,
  now = () => Date.now(),
} = {}) {
  if (!['read', 'mutate', 'queue', 'manage'].includes(action))
    throw Error('invalid comments action');
  const admin = ['queue', 'manage'].includes(action),
    write = ['mutate', 'manage'].includes(action);
  return async (req) => {
    const requestId = crypto.randomUUID(),
      auth = authed ? req.headers.get('x-veyrnox-auth-id') : null;
    const reply = (body, status = 200) => {
      console.info(
        JSON.stringify({
          event: 'cinema.comments',
          request_id: requestId,
          actor_id: UUID.test(auth || '') ? auth : undefined,
          action,
          status,
          code: body.error || 'ok',
        }),
      );
      return Response.json(
        { ...body, request_id: requestId },
        {
          status,
          headers: {
            'Cache-Control': 'no-store',
            'x-request-id': requestId,
            ...(status === 429 ? { 'Retry-After': '60' } : {}),
          },
        },
      );
    };
    if (authed && !UUID.test(auth || ''))
      return reply({ error: 'not_authenticated' }, 401);
    const flags = cinemaFeatures(process.env);
    if (!flags.comments || !flags.viewing)
      return reply({ error: 'comments_not_open' }, 503);
    try {
      let mfaAt;
      const cfg = envConfig(),
        query = new URL(req.url).searchParams;
      if (admin) {
        const raw = req.headers.get('x-veyrnox-auth-mfa-at');
        mfaAt = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
        const current = Math.floor(now() / 1000);
        if (
          req.headers.get('x-veyrnox-auth-aal') !== 'aal2' ||
          !Number.isSafeInteger(mfaAt) ||
          mfaAt < current - 300 ||
          mfaAt > current + 5
        )
          return reply({ error: 'recent_mfa_required' }, 403);
        if (!process.env.ACCESS_TEAM_DOMAIN || !process.env.ACCESS_AUD)
          return reply({ error: 'temporarily_unavailable' }, 503);
        try {
          const token = req.headers.get('cf-access-jwt-assertion');
          if (!token) {
            console.error(
              '[access] refused: no assertion on a Cinema administrator request',
            );
            return reply({ error: 'access_required' }, 403);
          }
          await accessVerifier(token, {
            teamDomain: process.env.ACCESS_TEAM_DOMAIN,
            aud: process.env.ACCESS_AUD,
          });
        } catch (err) {
          console.error('[access] refused:', (err && err.reason) || 'invalid');
          return reply({ error: 'access_required' }, 403);
        }
      }
      let body = {},
        key;
      if (action === 'read') {
        if (
          [...query.keys()].some(
            (k) => !['content_id', 'before_id'].includes(k),
          ) ||
          query.getAll('content_id').length !== 1 ||
          !UUID.test(query.get('content_id') || '') ||
          query.getAll('before_id').length > 1 ||
          (query.has('before_id') && !UUID.test(query.get('before_id') || ''))
        )
          return reply({ error: 'invalid_query' }, 400);
      } else if (query.size) return reply({ error: 'invalid_query' }, 400);
      if (write) {
        key = req.headers.get('idempotency-key');
        if (!UUID.test(key || ''))
          return reply({ error: 'invalid_idempotency_key' }, 400);
        if (
          req.headers.get('content-type')?.split(';')[0].trim() !==
          'application/json'
        )
          return reply({ error: 'invalid_content_type' }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response)
          return reply({ error: 'invalid_body' }, limited.response.status);
        body = await limited.request.json().catch(() => null);
        if (
          !(action === 'mutate'
            ? validCommentMutation(body)
            : validCommentDecision(body))
        )
          return reply({ error: 'invalid_body' }, 400);
      }
      if (authed) {
        const rate = await rpcCall(
          'consume_account_read_request',
          { p_auth_id: auth },
          cfg,
        );
        if (rate?.code === 'RATE_LIMITED')
          return reply({ error: 'rate_limited' }, 429);
        if (rate?.ok !== true)
          return reply({ error: 'temporarily_unavailable' }, 503);
      }
      const gate = { p_auth_id: auth, p_aal: 'aal2', p_mfa_at: mfaAt };
      const [name, args] =
        action === 'read'
          ? [
              'read_cinema_comments',
              {
                p_auth_id: auth,
                p_content_id: query.get('content_id'),
                p_before_id: query.get('before_id'),
              },
            ]
          : action === 'mutate'
            ? [
                'mutate_cinema_comments',
                { p_auth_id: auth, p_idempotency_key: key, p_payload: body },
              ]
            : action === 'queue'
              ? ['list_cinema_comment_review', gate]
              : [
                  'manage_cinema_comments',
                  {
                    ...gate,
                    p_idempotency_key: key,
                    p_payload: body,
                    p_request_id: requestId,
                  },
                ];
      const result = await rpcCall(name, args, cfg);
      if (result?.error)
        return reply(
          {
            error: errors[result.error]
              ? result.error
              : 'temporarily_unavailable',
          },
          errors[result.error] || 503,
        );
      if (action === 'read') {
        const valid = (c) =>
          UUID.test(c.id || '') &&
          length(c.body, 1, 2000) &&
          Number.isFinite(Date.parse(c.created_at));
        if (
          !Array.isArray(result?.comments) ||
          result.comments.length > 25 ||
          result.comments.some(
            (c) =>
              !valid(c) ||
              !length(c.username, 1, 30) ||
              !length(c.display_name, 1, 80),
          ) ||
          !Array.isArray(result.own_comments) ||
          result.own_comments.length > 25 ||
          result.own_comments.some(
            (c) => !valid(c) || !states.includes(c.status),
          ) ||
          (result.next_cursor !== null && !UUID.test(result.next_cursor || ''))
        )
          return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({
          comments: result.comments.map((c) => ({
            id: c.id,
            body: c.body,
            created_at: c.created_at,
            username: c.username,
            display_name: c.display_name,
            own: authed && c.own === true,
          })),
          own_comments: authed
            ? result.own_comments.map((c) => ({
                id: c.id,
                body: c.body,
                status: c.status,
                created_at: c.created_at,
              }))
            : [],
          next_cursor: result.next_cursor,
        });
      }
      if (action === 'queue') {
        if (!Array.isArray(result?.comments) || !Array.isArray(result?.reports))
          return reply({ error: 'temporarily_unavailable' }, 503);
        return reply(result);
      }
      if (
        !UUID.test(result?.id || '') ||
        typeof result.idempotent !== 'boolean' ||
        ![...states, 'open', 'resolved'].includes(result.status)
      )
        return reply({ error: 'temporarily_unavailable' }, 503);
      return reply(
        { id: result.id, status: result.status, idempotent: result.idempotent },
        result.idempotent ? 200 : 201,
      );
    } catch {
      return reply({ error: 'temporarily_unavailable' }, 503);
    }
  };
}
