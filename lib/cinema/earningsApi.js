import { rpc, envConfig, SupabaseError } from '../../packages/db/supabase-client.js';
import { verifyAccessJwt } from '../accessJwt.js';
import { cinemaFeatures } from './features.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const NOT_ADMIN = '42501';

/** The month a `?month=YYYY-MM` query names, or this month in UTC when absent. */
export function earningsMonth(query, now = Date.now()) {
  const raw = query.get('month');
  if (raw === null) { const d = new Date(now); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
  return MONTH.test(raw) ? raw : null;
}

/**
 * GET /api/v1/admin/cinema/earnings?month=YYYY-MM — what each title earned
 * (ADR-0057 Phase 3). Same three gates as the creator review queue: verified
 * identity, a second factor satisfied within five minutes, and a Cloudflare
 * Access assertion; then operator_cinema_earnings re-checks users.is_admin.
 * Nothing is paid out from here; this is the read a revenue-share ADR needs.
 */
export function earningsHandler({ rpcCall = rpc, accessVerifier = verifyAccessJwt, now = () => Date.now() } = {}) {
  return async (req) => {
    const id = crypto.randomUUID();
    const auth = req.headers.get('x-veyrnox-auth-id');
    const reply = (body, status = 200) => {
      console.info(JSON.stringify({ event: 'cinema.earnings', request_id: id, actor_id: UUID.test(auth || '') ? auth : undefined, status, code: body.error || 'ok' }));
      return Response.json({ ...body, request_id: id }, { status, headers: { 'Cache-Control': 'no-store', 'x-request-id': id } });
    };
    if (!UUID.test(auth || '')) return reply({ error: 'not_authenticated' }, 401);
    if (!cinemaFeatures(process.env).subscriptions) return reply({ error: 'pass_not_open' }, 503);
    try {
      const raw = req.headers.get('x-veyrnox-auth-mfa-at');
      const mfaAt = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
      const nowSec = Math.floor(now() / 1000);
      if (req.headers.get('x-veyrnox-auth-aal') !== 'aal2' || !Number.isSafeInteger(mfaAt) || mfaAt < nowSec - 300 || mfaAt > nowSec + 5) return reply({ error: 'recent_mfa_required' }, 403);
      const assertion = req.headers.get('cf-access-jwt-assertion');
      if (!process.env.ACCESS_TEAM_DOMAIN || !process.env.ACCESS_AUD) return reply({ error: 'temporarily_unavailable' }, 503);
      if (!assertion) return reply({ error: 'access_required' }, 403);
      try { await accessVerifier(assertion, { teamDomain: process.env.ACCESS_TEAM_DOMAIN, aud: process.env.ACCESS_AUD }); }
      catch { return reply({ error: 'access_required' }, 403); }

      const query = new URL(req.url).searchParams;
      if ([...query.keys()].some((k) => k !== 'month')) return reply({ error: 'invalid_request' }, 400);
      const month = earningsMonth(query, now());
      if (!month) return reply({ error: 'invalid_month' }, 400);
      const db = envConfig();
      const rate = await rpcCall('consume_account_read_request', { p_auth_id: auth }, db);
      if (rate?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited' }, 429);
      if (rate?.ok !== true) return reply({ error: 'temporarily_unavailable' }, 503);
      let r;
      try { r = await rpcCall('operator_cinema_earnings', { p_auth_id: auth, p_month: `${month}-01` }, db); }
      catch (err) {
        const body = err instanceof SupabaseError ? err.body : null;
        const code = body && (body.code || (body.error && body.error.code));
        if (code === NOT_ADMIN || JSON.stringify(body || '').includes('not_admin')) return reply({ error: 'not_admin' }, 403);
        throw err;
      }
      if (r?.ok !== true || !Array.isArray(r.content)) return reply({ error: r?.code === 'INVALID_MONTH' ? 'invalid_month' : 'temporarily_unavailable' }, r?.code === 'INVALID_MONTH' ? 400 : 503);
      return reply({ month: r.month, generated_at: r.generated_at, content: r.content, totals: r.totals });
    } catch { return reply({ error: 'temporarily_unavailable' }, 503); }
  };
}
