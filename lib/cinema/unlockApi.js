import { rpc, envConfig } from '../../packages/db/supabase-client.js';
import { limitRequestBody } from '../requestBodyLimit.js';
import { cinemaFeatures } from './features.js';
import { playbackConfig, signStreamPlayback, PLAYBACK_TTL_SECONDS } from './stream.js';

/** Supply Consent wording version an Unlock records (ADR-0057 §5, ADR-0018 §6). */
export const UNLOCK_CONSENT_VERSION = 'unlock-2026-09-26';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Typed errors the RPCs return, mapped to statuses. Anything else is 503.
const errors = {
  not_authenticated: 401, account_not_active: 403, account_frozen: 403, locked: 402,
  insufficient_credits: 402, consent_required: 400, content_not_found: 404, not_ready: 409,
  rate_limited: 429,
};

/**
 * One handler for the three viewer endpoints. `action` is 'entitlement' (GET),
 * 'unlock' (POST) or 'play' (POST). Identity comes only from the middleware's
 * x-veyrnox-auth-id header; prices come only from the database.
 */
export function unlockHandler({ action = 'entitlement', rpcCall = rpc, sign = signStreamPlayback, now = () => Date.now() } = {}) {
  return async (req) => {
    const id = crypto.randomUUID();
    const auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200) => {
      console.info(JSON.stringify({ event: 'cinema.unlock', request_id: id, actor_id: UUID.test(auth || '') ? auth : undefined, action, status, code: body.error || 'ok' }));
      const headers = { 'Cache-Control': 'no-store', 'x-request-id': id };
      if (status === 429) headers['Retry-After'] = String(body.retry_after_seconds || 60);
      return Response.json({ ...body, request_id: id }, { status, headers });
    };
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (!cinemaFeatures(process.env).unlocks) return reply({ error: 'unlocks_not_open' }, 503);
    try {
      const db = envConfig();
      const query = new URL(req.url).searchParams;
      let body;
      if (action === 'entitlement') {
        if ([...query.keys()].some((k) => k !== 'content_id') || query.getAll('content_id').length !== 1) return reply({ error: 'invalid_request' }, 400);
        body = { content_id: query.get('content_id') };
      } else {
        if (query.size) return reply({ error: 'invalid_request' }, 400);
        if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply({ error: 'invalid_content_type' }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response) return reply({ error: 'invalid_body' }, limited.response.status);
        try { body = await limited.request.json(); } catch { return reply({ error: 'invalid_body' }, 400); }
      }
      const allowed = action === 'unlock' ? ['content_id', 'consent_version'] : ['content_id'];
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((k) => !allowed.includes(k))
        || typeof body.content_id !== 'string' || !UUID.test(body.content_id)) return reply({ error: 'invalid_request' }, 400);
      // The client must acknowledge the wording in force, not any wording.
      if (action === 'unlock' && body.consent_version !== UNLOCK_CONSENT_VERSION) return reply({ error: 'consent_required', consent_version: UNLOCK_CONSENT_VERSION }, 400);

      // Playback needs a signing key; refuse before spending the account quota.
      const cfg = action === 'play' ? playbackConfig() : null;
      if (action === 'play' && !cfg) return reply({ error: 'playback_not_configured' }, 503);

      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, db);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited', retry_after_seconds: rate.retry_after_seconds }, 429);
      if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);

      const args = { p_auth_id: auth, p_content_id: body.content_id };
      if (action === 'entitlement') {
        const ent = await rpcCall('cinema_entitlement', args, db);
        if (ent?.error) return reply({ error: Object.hasOwn(errors, ent.error) ? ent.error : 'temporarily_unavailable' }, errors[ent.error] || 503);
        if (!['free', 'unlocked', 'locked'].includes(ent?.access)) return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({ access: ent.access, credits: ent.credits, content_id: body.content_id, consent_version: UNLOCK_CONSENT_VERSION });
      }
      if (action === 'unlock') {
        const r = await rpcCall('unlock_cinema_content', { ...args, p_consent_version: body.consent_version }, db);
        if (r?.error) {
          const known = Object.hasOwn(errors, r.error);
          const extra = r.error === 'insufficient_credits' ? { credits: r.credits, balance: r.balance }
            : r.error === 'rate_limited' ? { retry_after_seconds: r.retry_after_seconds } : {};
          return reply({ error: known ? r.error : 'temporarily_unavailable', ...extra }, known ? errors[r.error] : 503);
        }
        if (r?.ok !== true || !['free', 'unlocked'].includes(r.access)) return reply({ error: 'temporarily_unavailable' }, 503);
        return reply({ access: r.access, credits: r.credits, balance_after: r.balance_after ?? null, idempotent: r.idempotent === true, content_id: body.content_id }, r.idempotent === true ? 200 : 201);
      }
      const p = await rpcCall('read_cinema_playback', args, db);
      if (p?.error) return reply({ error: Object.hasOwn(errors, p.error) ? p.error : 'temporarily_unavailable', ...(p.error === 'locked' ? { credits: p.credits } : {}) }, errors[p.error] || 503);
      if (typeof p?.stream_uid !== 'string') return reply({ error: 'temporarily_unavailable' }, 503);
      const expires = Math.floor(now() / 1000) + PLAYBACK_TTL_SECONDS;
      const token = await sign(p.stream_uid, cfg, expires);
      return reply({ token, expires_at: new Date(expires * 1000).toISOString(), customer_code: cfg.customerCode, content_id: body.content_id });
    } catch { return reply({ error: 'temporarily_unavailable' }, 503); }
  };
}
