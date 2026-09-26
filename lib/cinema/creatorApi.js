import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { verifyAccessJwt } from '../accessJwt.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors = { invalid_application: 400, invalid_review: 400, profile_required: 409,
  account_not_active: 403, not_authorized: 403, self_review_forbidden: 403,
  application_exists: 409, idempotency_conflict: 409, role_not_eligible: 403,
  application_not_found: 404, already_reviewed: 409 };

// Dependency injection supports isolated boundary tests; production uses defaults.
export function creatorHandler({ review = false, create = false, rpcCall = rpc, accessVerifier = verifyAccessJwt } = {}) {
  return async req => {
    const requestId = crypto.randomUUID();
    const auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200, headers = {}) => {
      console.info(JSON.stringify({ event: 'cinema.creator', request_id: requestId,
        actor_id: UUID.test(auth || '') ? auth : undefined,
        route: review ? 'review' : 'application', action: create ? 'write' : 'read',
        status, code: body.error || 'ok' }));
      return Response.json({ ...body, request_id: requestId }, { status,
        headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId, ...headers } });
    };
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (!cinemaFeatures(process.env).creators) return reply({ error: 'creators_not_open' }, 503);
    const cfg = envConfig();
    try {
      let mfaAt;
      if (review) {
        const raw = req.headers.get('x-veyrnox-auth-mfa-at');
        mfaAt = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
        const now = Math.floor(Date.now() / 1000);
        if (req.headers.get('x-veyrnox-auth-aal') !== 'aal2' || !Number.isSafeInteger(mfaAt)
          || mfaAt < now - 300 || mfaAt > now + 5) return reply({ error: 'recent_mfa_required' }, 403);
        // Unlike machine cron endpoints, no internal/unconfigured bypass here.
        const assertion = req.headers.get('cf-access-jwt-assertion');
        if (!process.env.ACCESS_TEAM_DOMAIN || !process.env.ACCESS_AUD) return reply({ error: 'temporarily_unavailable' }, 503);
        if (!assertion) return reply({ error: 'access_required' }, 403);
        try { await accessVerifier(assertion, { teamDomain: process.env.ACCESS_TEAM_DOMAIN, aud: process.env.ACCESS_AUD }); }
        catch { return reply({ error: 'access_required' }, 403); }
      }
      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, cfg);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
      if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
      let name = review ? 'list_cinema_creator_applications' : 'read_own_cinema_application';
      let args = review ? { p_auth_id: auth, p_aal: 'aal2', p_mfa_at: mfaAt } : { p_auth_id: auth };
      if (create) {
        const key = req.headers.get('idempotency-key');
        if (!UUID.test(key || '')) return reply({ error: 'invalid_idempotency_key' }, 400);
        if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
        let body;
        try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
        const allowed = review ? ['application_id', 'decision', 'reason'] : ['statement'];
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !allowed.includes(k))) return reply({ error: 'invalid_body' }, 400);
        if (review) {
          if (!UUID.test(body.application_id || '') || !['approved','rejected'].includes(body.decision)
            || typeof body.reason !== 'string' || [...body.reason.trim()].length < 3 || [...body.reason.trim()].length > 500) return reply({ error: 'invalid_review' }, 400);
          name = 'review_cinema_creator';
          args = { ...args, p_idempotency_key: key, p_application_id: body.application_id, p_decision: body.decision, p_reason: body.reason.trim(), p_request_id: requestId };
        } else {
          if (typeof body.statement !== 'string' || [...body.statement.trim()].length < 20 || [...body.statement.trim()].length > 1000) return reply({ error: 'invalid_application' }, 400);
          name = 'apply_cinema_creator';
          args = { ...args, p_idempotency_key: key, p_statement: body.statement.trim() };
        }
      }
      const result = await rpcCall(name, args, cfg);
      if (result?.error && Object.hasOwn(errors, result.error)) return reply({ error: result.error }, errors[result.error]);
      const valid = create ? UUID.test(result?.id || '') && ['pending','approved','rejected'].includes(result.status)
        : review ? Array.isArray(result?.applications) : result && Object.hasOwn(result, 'application');
      if (!valid) return reply({ error: 'temporarily_unavailable' }, 503);
      return reply(result, create && !review && !result.idempotent ? 201 : 200);
    } catch { return reply({ error: 'temporarily_unavailable' }, 503); }
  };
}
