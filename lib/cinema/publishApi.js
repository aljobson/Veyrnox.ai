import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { verifyAccessJwt } from '../accessJwt.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';

/** The Rights Declaration wording a submission records (ADR-0059). A new wording needs a new version on both sides. */
export const RIGHTS_VERSION = 'rights-2026-09-26';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors = {
  creator_required: 403, account_not_active: 403, not_authorized: 403, self_review_forbidden: 403,
  invalid_submission: 400, invalid_withdrawal: 400, invalid_review: 400, invalid_suspension: 400,
  content_not_found: 404, submission_not_found: 404,
  already_submitted: 409, already_published: 409, suspended: 409, not_withdrawable: 409, already_reviewed: 409,
  already_suspended: 409, idempotency_conflict: 409, no_episodes: 422, video_not_ready: 422,
};
const bodies = {
  submit: ['content_id', 'rights_version'], withdraw: ['content_id', 'reason'],
  review: ['submission_id', 'decision', 'reason', 'creator_note'], suspend: ['content_id', 'reason'],
};
const text = (v, min, max) => typeof v === 'string' && [...v.trim()].length >= min && [...v.trim()].length <= max;

/**
 * Creator actions ('submit', 'withdraw') and administrator actions ('queue',
 * 'review', 'suspend') for publication. Administrator actions carry the same
 * three gates as the creator review queue: verified identity, a second factor
 * satisfied within five minutes, and a Cloudflare Access assertion, and every
 * RPC re-checks the Cinema administrator role itself.
 */
export function publishHandler({ action = 'submit', rpcCall = rpc, accessVerifier = verifyAccessJwt, now = () => Date.now() } = {}) {
  const admin = ['queue', 'review', 'suspend'].includes(action);
  const write = action !== 'queue';
  return async (req) => {
    const requestId = crypto.randomUUID();
    const auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200, headers = {}) => {
      console.info(JSON.stringify({ event: 'cinema.publish', request_id: requestId, actor_id: UUID.test(auth || '') ? auth : undefined, action, status, code: body.error || 'ok' }));
      return Response.json({ ...body, request_id: requestId }, { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId, ...headers } });
    };
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (!cinemaFeatures(process.env).publishing) return reply({ error: 'publishing_not_open' }, 503);
    const cfg = envConfig();
    try {
      let mfaAt;
      if (admin) {
        const raw = req.headers.get('x-veyrnox-auth-mfa-at');
        mfaAt = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
        const nowSec = Math.floor(now() / 1000);
        if (req.headers.get('x-veyrnox-auth-aal') !== 'aal2' || !Number.isSafeInteger(mfaAt) || mfaAt < nowSec - 300 || mfaAt > nowSec + 5) return reply({ error: 'recent_mfa_required' }, 403);
        const assertion = req.headers.get('cf-access-jwt-assertion');
        if (!process.env.ACCESS_TEAM_DOMAIN || !process.env.ACCESS_AUD) return reply({ error: 'temporarily_unavailable' }, 503);
        if (!assertion) return reply({ error: 'access_required' }, 403);
        try { await accessVerifier(assertion, { teamDomain: process.env.ACCESS_TEAM_DOMAIN, aud: process.env.ACCESS_AUD }); }
        catch { return reply({ error: 'access_required' }, 403); }
      }
      if (new URL(req.url).searchParams.size) return reply({ error: 'invalid_query' }, 400);
      let body = {}, key;
      if (write) {
        key = req.headers.get('idempotency-key');
        if (!UUID.test(key || '')) return reply({ error: 'invalid_idempotency_key' }, 400);
        if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
        try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((k) => !bodies[action].includes(k))) return reply({ error: 'invalid_body' }, 400);
        if (action === 'submit') {
          if (!UUID.test(body.content_id || '')) return reply({ error: 'invalid_submission' }, 400);
          // The creator must declare the wording in force, not any wording.
          if (body.rights_version !== RIGHTS_VERSION) return reply({ error: 'rights_version_required', rights_version: RIGHTS_VERSION }, 400);
        }
        if (action === 'withdraw' && (!UUID.test(body.content_id || '') || !text(body.reason, 3, 500))) return reply({ error: 'invalid_withdrawal' }, 400);
        if (action === 'review' && (!UUID.test(body.submission_id || '') || !['approved', 'rejected'].includes(body.decision) || !text(body.reason, 3, 500)
          || (body.creator_note !== undefined && (typeof body.creator_note !== 'string' || [...body.creator_note].length > 500)))) return reply({ error: 'invalid_review' }, 400);
        if (action === 'suspend' && (!UUID.test(body.content_id || '') || !text(body.reason, 3, 500))) return reply({ error: 'invalid_suspension' }, 400);
      }
      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, cfg);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
      if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);

      const gate = { p_auth_id: auth, p_aal: 'aal2', p_mfa_at: mfaAt };
      const call = {
        submit: () => ['submit_cinema_title', { p_auth_id: auth, p_idempotency_key: key, p_content_id: body.content_id, p_rights_version: body.rights_version }],
        withdraw: () => ['withdraw_cinema_title', { p_auth_id: auth, p_idempotency_key: key, p_content_id: body.content_id, p_reason: body.reason.trim() }],
        queue: () => ['list_cinema_submissions', gate],
        review: () => ['review_cinema_submission', { ...gate, p_idempotency_key: key, p_submission_id: body.submission_id, p_decision: body.decision, p_reason: body.reason.trim(), p_creator_note: body.creator_note?.trim() || null, p_request_id: requestId }],
        suspend: () => ['suspend_cinema_title', { ...gate, p_idempotency_key: key, p_content_id: body.content_id, p_reason: body.reason.trim(), p_request_id: requestId }],
      }[action]();
      const result = await rpcCall(call[0], call[1], cfg);
      if (result?.error && Object.hasOwn(errors, result.error)) return reply({ error: result.error, ...(result.missing ? { missing: result.missing } : {}) }, errors[result.error]);
      const valid = action === 'queue' ? Array.isArray(result?.submissions)
        : action === 'submit' ? UUID.test(result?.id || '') && ['pending', 'approved', 'rejected', 'withdrawn'].includes(result.status)
          : action === 'review' ? ['approved', 'rejected'].includes(result?.status)
            : UUID.test(result?.content_id || '') && Number.isInteger(result.unlocks_reversed);
      if (!valid) return reply({ error: 'temporarily_unavailable' }, 503);
      return reply(result, action === 'submit' && !result.idempotent ? 201 : 200);
    } catch { return reply({ error: 'temporarily_unavailable' }, 503); }
  };
}
