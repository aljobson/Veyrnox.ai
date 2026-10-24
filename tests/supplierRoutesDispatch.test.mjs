import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routesEnabled, resolveOwnRoute, recordFirstAttempt } from '../lib/supplierRoutesDispatch.js';

const offer = { id: 'nano-banana-kie', provider: 'kie', provider_endpoint: 'market:google/nano-banana' };
const own = { id: 'r1', supplier: 'kie', endpoint: 'market:google/nano-banana', priority: 1, state: 'active', provenance: 'licensed_reseller', parity_record: 'x', cost_per_unit: 0.02, cost_unit: 'per_generation' };
const on = { SUPPLIER_ROUTES_ENABLED: 'true' };

test('off unless exactly "true"; off does no read', async () => {
  assert.equal(routesEnabled({}), false);
  assert.equal(routesEnabled({ SUPPLIER_ROUTES_ENABLED: '1' }), false);
  let reads = 0;
  assert.equal(await resolveOwnRoute(offer, {}, { env: {}, read: async () => { reads += 1; return [own]; } }), null);
  assert.equal(reads, 0);
});

test('on: returns the offer\'s own route, never another one', async () => {
  assert.equal((await resolveOwnRoute(offer, {}, { env: on, read: async () => [own] })).id, 'r1');
  const logs = [];
  const other = { ...own, supplier: 'fal', endpoint: 'fal-ai/x' };
  assert.equal(await resolveOwnRoute(offer, {}, { env: on, read: async () => [other], log: (...a) => logs.push(a) }), null);
  assert.match(logs[0][0], /dispatching as today/);
  assert.equal(await resolveOwnRoute(offer, {}, { env: on, read: async () => [], log: () => {} }), null);
});

test('a read error means dispatch as today', async () => {
  const logs = [];
  assert.equal(await resolveOwnRoute(offer, {}, { env: on, read: async () => { throw new Error('relation does not exist'); }, log: (...a) => logs.push(a) }), null);
  assert.match(logs[0][0], /route read failed/);
});

test('recording attempt 1 sends the job, route and supplier job id, and never throws', async () => {
  let sent;
  assert.equal(await recordFirstAttempt({ jobId: 'j1', route: own, providerJobId: 'task_9' }, {}, { call: async (n, a) => { sent = [n, a]; return { ok: true, inserted: true }; } }), true);
  assert.deepEqual(sent, ['record_job_attempt', { p_job_id: 'j1', p_route_id: 'r1', p_supplier_job_id: 'task_9' }]);
  assert.equal(await recordFirstAttempt({ jobId: 'j1', route: null, providerJobId: 't' }, {}, { call: async () => assert.fail('no route, no call') }), false);
  assert.equal(await recordFirstAttempt({ jobId: 'j1', route: own, providerJobId: 't' }, {}, { call: async () => ({ ok: false, code: 'supplier_job_mismatch' }), log: () => {} }), false);
  assert.equal(await recordFirstAttempt({ jobId: 'j1', route: own, providerJobId: 't' }, {}, { call: async () => { throw new Error('boom'); }, log: () => {} }), false);
});

test('the route resolves before dispatch and records only after job_submitted succeeded', () => {
  const src = readFileSync(new URL('../app/api/v1/generations/route.js', import.meta.url), 'utf8');
  const resolve = src.indexOf('await resolveOwnRoute(modelRow, cfg)');
  const submit = src.indexOf('await provider.submit(');
  const record = src.indexOf('if (recorded) await recordFirstAttempt(');
  assert.ok(resolve > 0 && resolve < submit && submit < record);
  assert.match(src, /const recorded = await recordSubmittedJob/);
});

test('migration 0370 only inserts, checks the job and route, and is service-role only', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0370_record_job_attempt.sql', import.meta.url), 'utf8');
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /supplier_job_mismatch/);
  assert.match(sql, /route_not_for_job/);
  assert.match(sql, /ON CONFLICT \(job_id, attempt_no\) DO NOTHING/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.record_job_attempt\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.record_job_attempt\(uuid, uuid, text\) TO service_role/);
  assert.doesNotMatch(sql, /UPDATE |DELETE FROM|ledger|credit_balances/);
});

test('outcome marking is off without the flag and never throws', async () => {
  const { markAttemptOutcome } = await import('../lib/supplierRoutesDispatch.js');
  const sent = [];
  const call = async (n, a) => { sent.push([n, a]); return { ok: true, updated: 1 }; };
  assert.equal(await markAttemptOutcome({ provider: 'kie', providerJobId: 't1', outcome: 'completed' }, {}, { env: {}, call }), false);
  assert.deepEqual(sent, []);
  assert.equal(await markAttemptOutcome({ provider: 'kie', providerJobId: 't1', outcome: 'completed' }, {}, { env: on, call }), true);
  assert.deepEqual(sent[0], ['mark_job_attempt_outcome', { p_provider: 'kie', p_supplier_job_id: 't1', p_outcome: 'completed' }]);
  assert.equal(await markAttemptOutcome({ provider: 'kie', providerJobId: 't1', outcome: 'failed' }, {}, { env: on, call: async () => { throw new Error('boom'); }, log: () => {} }), false);
  assert.equal(await markAttemptOutcome({ provider: 'kie', providerJobId: 't1', outcome: 'failed' }, {}, { env: on, call: async () => ({ ok: false, code: 'invalid_outcome' }), log: () => {} }), false);
});

test('the completion paths mark an outcome only after their own state RPC returned ok', () => {
  for (const [file, ok] of [['../lib/providerCompletion.js', ['succeeded', 'failed']], ['../lib/falWebhookHandler.js', ['succeededRes', 'failRes']]]) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const v of ok) assert.match(src, new RegExp(`if \\(${v} && ${v}\\.ok === true\\) await markAttemptOutcome`), `${file} ${v}`);
  }
});

test('migration 0372 only updates job_attempts forward from submitted and is service-role only', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0372_mark_job_attempt_outcome.sql', import.meta.url), 'utf8');
  assert.match(sql, /UPDATE public\.job_attempts a/);
  assert.match(sql, /a\.outcome = 'submitted'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.mark_job_attempt_outcome\(text, text, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mark_job_attempt_outcome\(text, text, text\) TO service_role/);
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /UPDATE public\.jobs|ledger|credit_balances|DELETE FROM/);
});
