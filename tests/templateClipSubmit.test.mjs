import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const { finishGenerationSubmit } = await import('../lib/generationProviderSubmit.js');
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' };

async function finish(t, result, { recordOk = true, ownRoute = null } = {}) {
  const calls = []; let submits = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (target, init) => {
    const url = new URL(target);
    assert.equal(url.origin, cfg.supabaseUrl);
    const name = url.pathname.split('/').at(-1);
    calls.push([name, JSON.parse(init.body)]);
    return Response.json({ ok: name !== 'job_submitted' || recordOk });
  });
  const response = await finishGenerationSubmit({ jobId: 'job', userId: 'user', credits: 85,
    modelRow: { provider: 'fal', provider_endpoint: 'fixture' }, ownRoute, offerRoutes: [],
    rawKeys: [], rawAssets: [], record: {}, modelInputs: { prompt: 'effective' }, storedInputs: {}, sources: {},
    provider: { submit: async job => { submits++; assert.equal(job.inputs.prompt, 'effective'); return result; } },
    providerKey: 'mock', balanceAfter: 100, debit: {},
  }, cfg);
  assert.equal(submits, 1);
  return { response, calls, body: await response.json() };
}

test('finishGenerationSubmit holds an unknown outcome without refund or recording a submission', async t => {
  const { response, body, calls } = await finish(t, { ok: false, outcome: 'unknown' });
  assert.equal(response.status, 503); assert.deepEqual(body, { error: 'outcome_unknown', job_id: 'job' });
  assert.deepEqual(calls, [['job_submit_rejected', { p_job_id: 'job', p_error_code: 'provider_outcome_unknown' }]]);
});

test('finishGenerationSubmit records a proven refusal then refunds exactly once', async t => {
  const { response, body, calls } = await finish(t, { ok: false, outcome: 'rejected', errorCode: 'provider_input_rejected' });
  assert.equal(response.status, 422); assert.deepEqual(body, { error: 'provider_input_rejected' });
  assert.deepEqual(calls, [
    ['job_submit_rejected', { p_job_id: 'job', p_error_code: 'provider_input_rejected' }],
    ['ledger_refund', { p_job_id: 'job', p_user_id: 'user', p_credits: 85, p_reason: 'refund:submit_failed' }],
  ]);
});

test('finishGenerationSubmit records the submitted job before its supplier attempt', async t => {
  const { response, body, calls } = await finish(t, { ok: true, providerJobId: 'task' }, { ownRoute: { id: 'route' } });
  assert.equal(response.status, 200); assert.deepEqual(body, { job_id: 'job', state: 'SUBMITTED', balance_after: 100 });
  assert.deepEqual(calls, [
    ['job_submitted', { p_job_id: 'job', p_provider: 'fal', p_provider_job_id: 'task' }],
    ['record_job_attempt', { p_job_id: 'job', p_route_id: 'route', p_supplier_job_id: 'task' }],
  ]);
});

test('finishGenerationSubmit cannot refund or record an attempt after a lost submission acknowledgement', async t => {
  const { response, calls } = await finish(t, { ok: true, providerJobId: 'task' }, { recordOk: false, ownRoute: { id: 'route' } });
  assert.equal(response.status, 503);
  assert.deepEqual(calls.map(([name]) => name), ['job_submitted', 'job_submit_rejected']);
});
