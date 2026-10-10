import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { verifyAccessLogin } from '../accessJwt.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v, min, max) =>
  typeof v === 'string' &&
  [...v.trim()].length >= min &&
  [...v.trim()].length <= max;
const instant = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
    v,
  ) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v.slice(0, 10);
const errors = {
  profile_required: 403,
  account_not_active: 403,
  not_authorized: 403,
  self_review_forbidden: 403,
  content_not_found: 404,
  competition_not_found: 404,
  vote_not_found: 404,
  competition_closed: 409,
  idempotency_conflict: 409,
  competition_capacity: 409,
  invalid_vote: 400,
  invalid_action: 400,
  invalid_competition: 400,
  rate_limited: 429,
};
const fields = {
  create_competition: [
    'action',
    'name',
    'starts_at',
    'ends_at',
    'target_types',
    'reason',
  ],
  close_competition: ['action', 'id', 'reason'],
  review_vote: ['action', 'id', 'decision', 'reason'],
};
const targetTypes = ['FILM', 'SHORT', 'TRAILER', 'SERIES', 'EPISODE'];
export function validVotingAction(body) {
  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== 'object' ||
    !fields[body.action] ||
    Object.keys(body).some((k) => !fields[body.action].includes(k)) ||
    !text(body.reason, 3, 500)
  )
    return false;
  if (body.action === 'create_competition')
    return (
      text(body.name, 1, 80) &&
      instant(body.starts_at) &&
      body.starts_at.endsWith('Z') &&
      instant(body.ends_at) &&
      body.ends_at.endsWith('Z') &&
      Date.parse(body.ends_at) > Date.parse(body.starts_at) &&
      Date.parse(body.ends_at) - Date.parse(body.starts_at) <= 31 * 86400000 &&
      Array.isArray(body.target_types) &&
      body.target_types.length > 0 &&
      body.target_types.length <= 5 &&
      new Set(body.target_types).size === body.target_types.length &&
      body.target_types.every((t) => targetTypes.includes(t))
    );
  return (
    UUID.test(body.id || '') &&
    (body.action !== 'review_vote' ||
      ['qualified', 'under_review', 'rejected'].includes(body.decision))
  );
}
export function votingHandler({
  action = 'read',
  authed = true,
  rpcCall = rpc,
  accessVerifier = verifyAccessLogin,
  now = () => Date.now(),
} = {}) {
  if (!['read', 'vote', 'queue', 'manage'].includes(action))
    throw Error('Invalid voting action');
  const admin = ['queue', 'manage'].includes(action),
    write = ['vote', 'manage'].includes(action);
  return async (req) => {
    const requestId = crypto.randomUUID(),
      auth = authed ? req.headers.get('x-veyrnox-auth-id') : null;
    const reply = (body, status = 200) => {
      console.info(
        JSON.stringify({
          event: 'cinema.voting',
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
    if (!flags.viewing || !flags.voting)
      return reply({ error: 'voting_not_open' }, 503);
    try {
      const cfg = envConfig();
      let mfaAt;
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
        const assertion = req.headers.get('cf-access-jwt-assertion');
        if (!assertion) {
          console.error(
            '[access] refused: no assertion on a Cinema administrator request',
          );
          return reply({ error: 'access_required' }, 403);
        }
        try {
          await accessVerifier(assertion, {
            teamDomain: process.env.ACCESS_TEAM_DOMAIN,
            aud: process.env.ACCESS_AUD,
          });
        } catch (err) {
          console.error('[access] refused:', (err && err.reason) || 'invalid');
          return reply({ error: 'access_required' }, 403);
        }
      }
      const query = new URL(req.url).searchParams;
      let body = {},
        key,
        contentId;
      if (action === 'read') {
        if (
          query.size !== 1 ||
          query.getAll('content_id').length !== 1 ||
          !UUID.test(query.get('content_id') || '')
        )
          return reply({ error: 'invalid_query' }, 400);
        contentId = query.get('content_id');
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
          action === 'vote' &&
          (!body ||
            Array.isArray(body) ||
            Object.keys(body).some(
              (k) => !['content_id', 'competition_id'].includes(k),
            ) ||
            !UUID.test(body.content_id || '') ||
            !UUID.test(body.competition_id || ''))
        )
          return reply({ error: 'invalid_vote' }, 400);
        if (action === 'manage' && !validVotingAction(body))
          return reply({ error: 'invalid_action' }, 400);
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
      const call =
        action === 'read'
          ? ['read_cinema_voting', { p_auth_id: auth, p_content_id: contentId }]
          : action === 'vote'
            ? [
                'cast_cinema_vote',
                {
                  p_auth_id: auth,
                  p_idempotency_key: key,
                  p_content_id: body.content_id,
                  p_competition_id: body.competition_id,
                },
              ]
            : action === 'queue'
              ? ['list_cinema_voting_review', gate]
              : [
                  'manage_cinema_voting',
                  {
                    ...gate,
                    p_idempotency_key: key,
                    p_payload: body,
                    p_request_id: requestId,
                  },
                ];
      const result = await rpcCall(call[0], call[1], cfg);
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
        if (
          !Array.isArray(result?.competitions) ||
          result.competitions.length > 25 ||
          result.competitions.some(
            (c) =>
              !UUID.test(c.id || '') ||
              !text(c.name, 1, 80) ||
              !Number.isSafeInteger(c.qualified_votes) ||
              c.qualified_votes < 0 ||
              !instant(c.starts_at) ||
              !instant(c.ends_at) ||
              (c.my_vote &&
                (!UUID.test(c.my_vote.id || '') ||
                  !['qualified', 'under_review', 'rejected'].includes(
                    c.my_vote.status,
                  ))),
          )
        )
          return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({
          competitions: result.competitions.map((c) => ({
            id: c.id,
            name: c.name,
            starts_at: c.starts_at,
            ends_at: c.ends_at,
            qualified_votes: c.qualified_votes,
            my_vote:
              authed && c.my_vote
                ? { id: c.my_vote.id, status: c.my_vote.status }
                : null,
          })),
        });
      }
      if (action === 'queue') {
        if (
          !Array.isArray(result?.competitions) ||
          !Array.isArray(result?.votes)
        )
          return reply({ error: 'temporarily_unavailable' }, 503);
        return reply(result);
      }
      if (
        !UUID.test(result?.id || '') ||
        typeof result.idempotent !== 'boolean' ||
        !(
          action === 'vote'
            ? ['qualified', 'under_review', 'rejected']
            : ['open', 'closed', 'qualified', 'under_review', 'rejected']
        ).includes(result.status)
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
