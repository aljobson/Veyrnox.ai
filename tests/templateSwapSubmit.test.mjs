import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const { finishGenerationSubmit } = await import('../lib/generationProviderSubmit.js');
for (const templateSwap of [false, true]) for (const [errorCode, error, status] of [
  ['script_refused', 'topic_refused', 422], ['provider_moderation', 'provider_moderation', 422],
  ['provider_input_rejected', 'provider_input_rejected', 422], ['other', 'provider_submit_failed', 502],
]) test(`refusal ${errorCode}, swap=${templateSwap}: byte-exact body even when refund fails`, async t => {
  const calls = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).origin, 'https://db.test');
    const name = new URL(url).pathname.split('/').at(-1); calls.push(name);
    if (name === 'ledger_refund') throw Error('offline');
    assert.equal(JSON.parse(init.body).p_job_id, 'debited-job');
    return Response.json({ ok: true });
  });
  const response = await finishGenerationSubmit({ templateSwap, jobId: 'debited-job', userId: 'internal-user', credits: 47,
    modelRow: { provider: 'fal', provider_endpoint: 'fixture' }, ownRoute: null, offerRoutes: [],
    rawKeys: [], rawAssets: [], record: {}, modelInputs: {}, storedInputs: {}, sources: {},
    provider: { submit: async () => ({ ok: false, outcome: 'rejected', errorCode }) },
    providerKey: 'fixture', balanceAfter: 100, debit: {},
  }, { supabaseUrl: 'https://db.test', serviceRoleKey: 'fixture' });
  assert.equal(response.status, status);
  assert.equal(await response.text(), JSON.stringify({ error, ...(templateSwap ? { job_id: 'debited-job' } : {}) }));
  assert.deepEqual(calls, ['job_submit_rejected', 'ledger_refund']);
});
