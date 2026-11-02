import { isFeatureKilled, refreshRuntimeSwitches } from './runtimeSwitchCache.js';
import { rpc } from '../packages/db/supabase-client.js';

export const featurePaused = () => Response.json({ error: 'feature_paused' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '15' } });
// Existing playback heartbeats, uploads/transfer, refresh, pass return/cancel,
// withdrawals, refunds, webhooks and admin operations must remain available.
export const CINEMA_ADMISSIONS = Object.freeze([
  'play','unlocks','pass','uploads','uploads/from-library','content','content/submit',
  'votes','voting','story-polls','story-choices',
]);
// Comment submission is paused inside its handler (lib/cinema/commentsApi.js): the same POST also withdraws and reports.
const CINEMA_REFRESH = Object.freeze([...CINEMA_ADMISSIONS, 'comments']);
export function prepareRuntimeAdmission(request, env, ctx, refresh = refreshRuntimeSwitches) {
  if (!['POST','PUT','PATCH'].includes(request.method)) return;
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  const cinema = CINEMA_REFRESH.some(p => path === '/api/v1/cinema/' + p);
  const generation = ['/api/v1/generations','/api/v1/developer/generations','/api/v1/mcp'].includes(path);
  const chat = /^\/api\/v1\/chat\/threads\/[^/]+\/messages$/.test(path);
  if (cinema || generation || chat) {
    const pending = refresh({ supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
    if (pending) { ctx?.waitUntil?.(pending.catch(() => {})); return pending; }
  }
}
export async function cinemaRuntimeGate(request, env, killed = isFeatureKilled) {
  if (!['POST','PUT','PATCH'].includes(request.method)) return null;
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  if (!CINEMA_ADMISSIONS.some(p => path === '/api/v1/cinema/' + p)) return null;
  return await killed('cinema', { supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }) ? featurePaused() : null;
}
export async function admitPublishTarget(target, cfg, { killed = isFeatureKilled, call = rpc } = {}) {
  // A nonempty server-written checkpoint denotes work already in flight.
  if (target.provider_state && Object.keys(target.provider_state).length) return null;
  if (!await killed('publish',cfg)) return null;
  // Restore the claim snapshot without consuming a retry. If restoration fails,
  // do not report a failure or dispatch: the existing stale-claim recovery owns it.
  try {
    const result = await call('runtime_defer_publish', { p_target_id: target.target_id, p_claim_key: target.claim_key }, cfg);
    if (!result?.ok) console.error('[runtime-switches] publish deferral unavailable');
  } catch { console.error('[runtime-switches] publish deferral unavailable'); }
  return { error: 'feature_paused', status: 503 };
}
