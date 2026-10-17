import { installProductFixtures } from './authenticated-product.mjs';
import { normaliseNarration } from '../../lib/montageNarration.js';

const JOB = '00000000-0000-4000-8000-000000000073';
// All writes are intercepted synthetic contracts on the same loopback origin.
// No real plan, generation, token, credentials or provider can leave this fixture.
export async function installNarrationFixtures(page, options = {}) {
  const plans = [], generations = [], tickets = new Map();
  const fixture = await installProductFixtures(page, { routes: async args => {
    const { url, origin, method, body, json, state } = args;
    if (url.origin !== origin) return false;
    if (url.pathname === '/api/v1/montage/plan' && method === 'POST') {
      const narration = normaliseNarration(body?.narration_text);
      if (!narration.ok || Object.keys(body).some(key => !['brief', 'aspect_ratio', 'narration_text'].includes(key))) return json({ error: 'inputs_invalid:narration_text' }, 400);
      plans.push(body); await options.beforePlan?.(body, plans.length);
      if (options.supported === false && narration.text) return json({ error: 'narration_unavailable' }, 503);
      const key = `synthetic_narration_${plans.length}`;
      const ticket = { plan_id: `synthetic-ticket-${plans.length}`, idempotency_key: key, credits: 165, expires_at: Math.floor(Date.now() / 1000) + 600,
        plan: { summary: 'Synthetic silent blue sphere visuals', seconds: 10, narration_supported: true }, ...(narration.text ? { narration_text: narration.text } : {}) };
      tickets.set(key, { brief: body.brief, aspect: body.aspect_ratio, script: narration.text, ticket });
      return json(ticket);
    }
    if (url.pathname === '/api/v1/generations' && method === 'POST') {
      const planned = tickets.get(body?.idempotency_key);
      if (!planned || body.model_id !== 'video-agent' || body.inputs?.brief !== planned.brief || body.inputs?.aspect_ratio !== planned.aspect
          || body.inputs?.plan_id !== planned.ticket.plan_id || (body.inputs?.narration_text || '') !== planned.script) return json({ error: 'plan_mismatch' }, 400);
      generations.push(body);
      if (generations.length > 1) throw new Error('Synthetic narration must never dispatch twice');
      state.balance -= 165;
      return json({ job_id: JOB, state: 'queued', balance_after: state.balance });
    }
    if (url.pathname === `/api/v1/jobs/${JOB}` && method === 'GET') return json({ job_id: JOB, state: 'running' });
    return false;
  } });
  return { ...fixture, plans, generations };
}
