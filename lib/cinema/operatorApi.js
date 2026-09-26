import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { verifyAccessJwt } from '../accessJwt.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';
import { refundFlaggedPass } from './operatorRefund.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = {
  not_authorized: 403, invalid_request: 400, content_not_found: 404, pass_not_found: 404, action_not_found: 404,
  content_still_published: 409, pass_not_flagged: 409, idempotency_conflict: 409, refund_already_requested: 409,
  pass_not_configured: 503, stripe_unavailable: 502, cancel_failed: 502, refund_review_required: 409, refund_failed: 409,
};

export function operatorHandler({ action = 'reverse_unlocks', rpcCall = rpc, accessVerifier = verifyAccessJwt,
  refund = refundFlaggedPass, now = () => Date.now(), fetcher } = {}) {
  if (!['reverse_unlocks', 'refund_pass'].includes(action)) throw new Error('Invalid Operator action');
  const target = action === 'reverse_unlocks' ? 'content_id' : 'pass_id';
  return async (req) => {
    const requestId = crypto.randomUUID();
    const auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200) => {
      const log = JSON.stringify({ event: 'cinema.operator', action, request_id: requestId,
        actor_id: UUID.test(auth || '') ? auth : undefined, status, code: body.error || 'ok' });
      if (status >= 400) console.error(log); else console.info(log);
      return Response.json({ ...body, request_id: requestId }, { status, headers: {
        'Cache-Control': 'no-store', 'x-request-id': requestId, ...(status === 429 ? { 'Retry-After': '60' } : {}),
      } });
    };
    const failure = (result) => Object.hasOwn(statuses, result?.error)
      ? reply({ error: result.error }, statuses[result.error]) : reply({ error: 'temporarily_unavailable' }, 503);
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    const flags = cinemaFeatures(process.env);
    if (!(action === 'reverse_unlocks' ? flags.unlocks : flags.subscriptions)) return reply({ error: 'operator_action_not_open' }, 503);
    try {
      const raw = req.headers.get('x-veyrnox-auth-mfa-at');
      const mfaAt = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
      const nowSec = Math.floor(now() / 1000);
      if (req.headers.get('x-veyrnox-auth-aal') !== 'aal2' || !Number.isSafeInteger(mfaAt) || mfaAt < nowSec - 300 || mfaAt > nowSec + 5) return reply({ error: 'recent_mfa_required' }, 403);
      if (!process.env.ACCESS_TEAM_DOMAIN || !process.env.ACCESS_AUD) return reply({ error: 'temporarily_unavailable' }, 503);
      const assertion = req.headers.get('cf-access-jwt-assertion');
      if (!assertion) return reply({ error: 'access_required' }, 403);
      try { await accessVerifier(assertion, { teamDomain: process.env.ACCESS_TEAM_DOMAIN, aud: process.env.ACCESS_AUD }); }
      catch { return reply({ error: 'access_required' }, 403); }
      if (new URL(req.url).searchParams.size) return reply({ error: 'invalid_request' }, 400);
      const key = req.headers.get('idempotency-key');
      if (!UUID.test(key || '')) return reply({ error: 'invalid_idempotency_key' }, 400);
      if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
      const limited = await limitRequestBody(req);
      if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
      let body;
      try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => ![target, 'reason'].includes(k))
          || typeof body[target] !== 'string' || !UUID.test(body[target]) || typeof body.reason !== 'string'
          || [...body.reason.trim()].length < 3 || [...body.reason.trim()].length > 500) return reply({ error: 'invalid_request' }, 400);
      body[target] = body[target].toLowerCase();
      const cfg = envConfig();
      const gate = { p_auth_id: auth, p_aal: 'aal2', p_mfa_at: mfaAt };
      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, cfg);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited' }, 429);
      if (rate?.ok !== true) return failure();
      const operation = await rpcCall('begin_cinema_operator_action', {
        ...gate, p_idempotency_key: key, p_action: action, p_target_id: body[target], p_reason: body.reason.trim(), p_request_id: requestId,
      }, cfg);
      if (operation?.ok !== true) return failure(operation);
      if (action === 'reverse_unlocks') {
        if (operation.content_id !== body.content_id || !Number.isSafeInteger(operation.unlocks_reversed) || operation.unlocks_reversed < 0
            || !Number.isSafeInteger(operation.credits_returned) || operation.credits_returned < 0) return failure();
        return reply({ ok: true, content_id: operation.content_id, unlocks_reversed: operation.unlocks_reversed,
          credits_returned: operation.credits_returned, idempotent: operation.idempotent === true });
      }
      if (operation.pass_id !== body.pass_id) return failure();
      if (operation.complete === true) {
        if (!Number.isSafeInteger(operation.refund_usd_cents) || operation.refund_usd_cents <= 0) return failure();
        return reply({ ok: true, pass_id: body.pass_id, refunded: true, refund_usd_cents: operation.refund_usd_cents, idempotent: true });
      }
      if (operation.complete !== false || !UUID.test(operation.action_id || '')
          || !/^sub_[A-Za-z0-9_]{1,250}$/.test(operation.subscription_id || '') || !/^cus_[A-Za-z0-9_]{1,250}$/.test(operation.customer_id || '')) return failure();
      const apiKey = process.env.STRIPE_SECRET_KEY;
      if (!/^sk_(live|test)_/.test(apiKey || '')) return failure({ error: 'pass_not_configured' });
      const result = await refund(operation, { apiKey, fetch: fetcher || fetch.bind(globalThis) });
      if (result?.pending === true) return reply({ ok: true, pass_id: body.pass_id, refunded: false, pending: true }, 202);
      if (result?.ok !== true) return failure(result);
      const completed = await rpcCall('complete_cinema_operator_refund', { ...gate, p_action_id: operation.action_id,
        p_refund_id: result.refundId, p_amount_usd_cents: result.amountCents, p_request_id: requestId }, cfg);
      if (completed?.ok !== true) return failure(completed);
      return reply({ ok: true, pass_id: body.pass_id, refunded: true, refund_usd_cents: result.amountCents, idempotent: completed.idempotent === true });
    } catch { return failure(); }
  };
}
