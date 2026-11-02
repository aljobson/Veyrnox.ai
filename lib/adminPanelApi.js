import { rpc, SupabaseError } from '../packages/db/supabase-client.js';
import { IDEMPOTENCY_RE, NO_STORE } from './adminGate.js';
import { readBoundedBody } from './boundedBody.js';

export const panelReply = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });
export function panelGateResponse(g) {
  if (g.response) g.response.headers.set('Cache-Control', 'no-store');
  return g.response;
}
export function panelWindow(req, limit = false) {
  const params = new URL(req.url).searchParams;
  for (const k of params.keys()) if (!['days', ...(limit ? ['limit'] : [])].includes(k) || params.getAll(k).length !== 1) return null;
  const days = params.get('days') ?? '30', count = params.get('limit') ?? '50';
  if (!/^[1-9]\d{0,2}$/.test(days) || Number(days) > 365
    || (limit && (!/^[1-9]\d{0,2}$/.test(count) || Number(count) > 100))) return null;
  return { p_days: Number(days), ...(limit ? { p_limit: Number(count) } : {}) };
}
export function panelFailure(error) {
  if (error instanceof SupabaseError) {
    if (error.body?.code === '42501') return panelReply({ error: error.body?.message === 'permission_denied' ? 'permission_denied' : 'not_admin' }, 403);
    if (error.body?.code === 'P0001' && error.body.message === 'mfa_required') return panelReply({ error: 'mfa_required' }, 403);
    if (error.body?.code === '22023') return panelReply({ error: 'input_invalid' }, 400);
  }
  console.error('[admin-panel] request failed', error instanceof SupabaseError ? error.status : 0);
  return panelReply({ error: 'admin_unavailable' }, 503);
}
export async function panelAccess(g, permission) {
  const access = await rpc('admin_permissions', { p_auth_id: g.authId }, g.cfg);
  if (access?.ok !== true || !Array.isArray(access.permissions)) throw new Error('access_unavailable');
  if (permission && !access.permissions.includes(permission)) {
    throw new SupabaseError('permission_denied', { status: 403, body: { code: '42501', message: 'permission_denied' } });
  }
  return access;
}
export async function panelRead(g, name, args = {}, permission) {
  try {
    const access = await panelAccess(g, permission);
    const data = await rpc(name, { p_auth_id: g.authId, ...args }, g.cfg);
    return data?.ok === true ? panelReply({ ...data, permissions: access.permissions, actor_user_id: access.user_id }) : panelReply({ error: 'admin_unavailable' }, 503);
  } catch (error) { return panelFailure(error); }
}
export function freshAdminMfa(req, now = Date.now(), maxAge = 300) {
  const raw = req.headers.get('x-veyrnox-auth-mfa-at');
  const seconds = /^\d{1,12}$/.test(raw || '') ? Number(raw) : NaN;
  const aal = req.headers.get('x-veyrnox-auth-aal');
  if (aal !== 'aal2' || !Number.isSafeInteger(seconds) || seconds < now / 1000 - maxAge || seconds > now / 1000 + 5) return null;
  return { p_aal: aal, p_mfa_at: new Date(seconds * 1000).toISOString() };
}
export async function panelWriteInput(req) {
  // Expired verified AAL2 can replay only: SQL checks the receipt before freshness.
  const mfa = freshAdminMfa(req, Date.now(), Infinity);
  if (!mfa) return { response: panelReply({ error: 'mfa_required' }, 403) };
  const key = req.headers.get('idempotency-key');
  if (!IDEMPOTENCY_RE.test(key || '')) return { response: panelReply({ error: 'idempotency_key_invalid' }, 400) };
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return { response: panelReply({ error: 'body_invalid' }, 400) };
  let body;
  try { body = JSON.parse(new TextDecoder().decode(await readBoundedBody(req.body, 4096, req.signal))); }
  catch (error) { return { response: panelReply({ error: error.status === 413 ? 'body_too_large' : 'body_invalid' }, error.status === 413 ? 413 : 400) }; }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.reason !== 'string'
    || !body.reason.trim() || body.reason.trim().length > 500 || /[\x00-\x1f\x7f]/.test(body.reason)) {
    return { response: panelReply({ error: 'reason_invalid' }, 400) };
  }
  return { body, trusted: { ...mfa, p_idem_key: key, p_reason: body.reason.trim() } };
}
export async function panelWrite(g, name, args, permission) {
  try {
    await panelAccess(g, permission);
    const result = await rpc(name, { p_auth_id: g.authId, ...args }, g.cfg);
    if (result?.ok === true) return panelReply(result);
    const codes = ['idempotency_key_reused','self_role_change','last_owner','no_role','target_not_admin','user_not_found','catalog_not_found','plan_read_only','plan_in_use'];
    return codes.includes(result?.code) ? panelReply({ error: result.code, ...(result.counts ? { counts: result.counts } : {}) }, result.code === 'user_not_found' ? 404 : 409)
      : panelReply({ error: 'admin_unavailable' }, 503);
  } catch (error) { return panelFailure(error); }
}
