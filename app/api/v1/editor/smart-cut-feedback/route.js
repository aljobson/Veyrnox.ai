import { envConfig, rpc } from '../../../../../packages/db/supabase-client.js';
import { isUuid } from '../../../../../lib/validate.js';
import { parseSmartCutFeedback, readSmartCutFeedbackJson } from '../../../../../lib/smartCutFeedback.js';

const reply = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', ...headers },
});

export async function POST(request) {
  const authId = request.headers.get('x-veyrnox-auth-id');
  if (!isUuid(authId || '')) return reply({ error: 'not_authenticated' }, 401);
  const decoded = await readSmartCutFeedbackJson(request);
  if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
  const parsed = parseSmartCutFeedback(decoded.value);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);
  const cfg = envConfig();
  if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
  let result;
  try {
    result = await rpc('submit_smart_cut_feedback', {
      p_auth_id: authId,
      p_response_id: parsed.feedback.response_id,
      p_rating: parsed.feedback.rating,
      p_comment: parsed.feedback.comment ?? null,
      p_plan_mode: parsed.feedback.plan_mode,
    }, cfg);
  } catch (error) {
    if (error?.status === 429) return reply({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
    console.error('[smart-cut-feedback] unavailable');
    return reply({ error: 'temporarily_unavailable' }, 502);
  }
  if (result?.ok === true) return reply({ accepted: true, replayed: result.replayed === true });
  if (result?.code === 'NOT_FOUND') return reply({ error: 'not_authenticated' }, 401);
  if (result?.code === 'IDEMPOTENCY_CONFLICT') return reply({ error: 'feedback_conflict' }, 409);
  if (result?.code === 'RATE_LIMITED') return reply({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
  return reply({ error: 'temporarily_unavailable' }, 502);
}
