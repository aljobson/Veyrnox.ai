import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routesEnabled, resolveOwnRoute, resolveRouteSet, recordFirstAttempt, markAttemptOutcome } from '../lib/supplierRoutesDispatch.js';
import { nextRoute } from '../lib/supplierRoutesFailover.js';
import { REFERENCE_REJECTED_LIKENESS } from '../lib/falFailureCode.js';

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

test('own route identity survives cooldown without mutating rows or admitting a cooled-down hop', async () => {
  const opened = new Date(Date.now() - 9 * 60_000).toISOString();
  const coolingOwn = Object.freeze({ ...own, breaker_opened_at: opened });
  const coolingNext = Object.freeze({ ...own, id: 'r2', supplier: 'fal', endpoint: 'fal-ai/x', priority: 2, breaker_opened_at: opened });
  const rows = Object.freeze([coolingOwn, coolingNext]);
  const result = await resolveRouteSet(offer, {}, { env: on, read: async () => rows });
  assert.equal(result.own, coolingOwn);
  assert.equal(result.own.breaker_opened_at, opened);
  assert.equal(result.routes, rows);
  assert.equal(nextRoute(result.routes, new Set([coolingOwn.id])), null);
});

test('the eligible own route keeps its identity when a higher-priority other route is cooling', async () => {
  const other = { ...own, id: 'other', supplier: 'fal', endpoint: 'fal-ai/x', breaker_opened_at: new Date().toISOString() };
  const eligibleOwn = { ...own, priority: 2 };
  const rows = [other, eligibleOwn];
  const result = await resolveRouteSet(offer, {}, { env: on, read: async () => rows });
  assert.equal(result.own, eligibleOwn);
  assert.equal(result.routes, rows);
  assert.equal(nextRoute(result.routes, new Set([eligibleOwn.id])), null);
});

test('own route keeps its identity when both it and a higher-priority other route are cooling', async () => {
  const opened = new Date().toISOString();
  const other = Object.freeze({ ...own, id: 'other', supplier: 'fal', endpoint: 'fal-ai/x', breaker_opened_at: opened });
  const coolingOwn = Object.freeze({ ...own, priority: 2, breaker_opened_at: opened });
  const rows = Object.freeze([other, coolingOwn]);
  const result = await resolveRouteSet(offer, {}, { env: on, read: async () => rows });
  assert.equal(result.own, coolingOwn);
  assert.equal(result.own.breaker_opened_at, opened);
  assert.equal(result.routes, rows);
  assert.equal(nextRoute(result.routes, new Set([coolingOwn.id])), null);
});

test('a healthy higher-priority other route still returns none', async () => {
  const other = { ...own, id: 'other', supplier: 'fal', endpoint: 'fal-ai/x' };
  assert.deepEqual(await resolveRouteSet(offer, {}, {
    env: on, read: async () => [other, { ...own, priority: 2 }], log: () => {},
  }), { own: null, routes: [] });
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
  const route = readFileSync(new URL('../app/api/v1/generations/route.js', import.meta.url), 'utf8');
  const helper = readFileSync(new URL('../lib/generationProviderSubmit.js', import.meta.url), 'utf8');
  const resolve = route.indexOf('await resolveRouteSet(modelRow, cfg)');
  const finish = route.indexOf('return finishGenerationSubmit(');
  assert.ok(resolve > 0 && finish > resolve);
  const submit = helper.indexOf('await submitWithFailover({');
  const submitted = helper.indexOf('const recorded = await recordSubmittedJob(');
  const record = helper.indexOf('if (recorded) await recordFirstAttempt(');
  assert.ok(submit > 0 && submitted > submit && record > submitted);
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

test('typed customer-content async outcomes do not count as route failures', async () => {
  const cfg = { marker: 'cfg' };
  for (const errorCode of ['provider_moderation', 'provider_moderated', REFERENCE_REJECTED_LIKENESS,
    'provider_task_failed', 'CONTENT_POLICY_VIOLATION', undefined, 'provider_moderation_extra']) {
    for (const outcome of ['failed', 'completed']) {
      const sent = [];
      const refused = outcome === 'failed' && ['provider_moderation', 'provider_moderated', REFERENCE_REJECTED_LIKENESS].includes(errorCode);
      assert.equal(await markAttemptOutcome({ provider: 'kie', providerJobId: 'task', outcome, errorCode }, cfg, {
        env: on, call: async (...args) => { sent.push(args); return { ok: true, updated: 1 }; },
      }), true);
      assert.deepEqual(sent, [[refused ? 'mark_job_attempt_refused' : 'mark_job_attempt_outcome', {
        p_provider: 'kie', p_supplier_job_id: 'task', ...(refused ? {} : { p_outcome: outcome }),
      }, cfg]], `${outcome}: ${errorCode}`);
    }
  }
});

test('both failure completion paths forward the adapter error code', () => {
  for (const [file, code] of [['providerCompletion.js', 'outcome.errorCode'], ['falWebhookHandler.js', 'errCode']]) {
    const src = readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8');
    const calls = src.match(/markAttemptOutcome\(\{[^}]+outcome: 'failed'[^}]+\}/g) || [];
    assert.equal(calls.length, 1, file);
    assert.ok(calls[0].includes(`errorCode: ${code}`), file);
  }
});

test('async refusal closure errors log once without counting, including a missing RPC', async () => {
  const errors = [
    { status: 404, body: { code: 'PGRST202' } },
    { status: 500, body: { code: 'PGRST202' } },
    { status: '404', body: { code: 'PGRST202' } },
    { status: 404, body: { code: 'PGRST205' } },
    { status: 404 }, new Error('network error'),
  ];
  for (const error of errors) {
    const calls = [], logs = [], cfg = { marker: 'cfg' };
    const result = await markAttemptOutcome({ provider: 'grsai', providerJobId: 't', outcome: 'failed', errorCode: 'provider_moderation' }, cfg, {
      env: on, call: async (name, args, config) => {
        assert.equal(config, cfg);
        calls.push([name, args]);
        if (name === 'mark_job_attempt_refused') throw error;
        return { ok: true, updated: 1 };
      }, log: (...args) => logs.push(args),
    });
    assert.equal(result, false);
    assert.deepEqual(calls, [
      ['mark_job_attempt_refused', { p_provider: 'grsai', p_supplier_job_id: 't' }],
    ]);
    assert.equal(logs.length, 1);
  }
});

test('0603 restates the gate with exactly the cooldown and Seedance endpoint changes', () => {
  const read = (name) => readFileSync(new URL(`../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');
  const sql = read('0603_route_failure_accounting.sql');
  const gate = (source) => source.match(/CREATE OR REPLACE FUNCTION public\.reserve_crun_create_slot\([\s\S]*?GRANT EXECUTE ON FUNCTION public\.reserve_crun_create_slot\(TEXT,TEXT,TEXT,TEXT\) TO service_role;/)[0];
  const expected = gate(read('0591_crun_suno_music_foundation.sql'))
    .replace("(p_endpoint IS NOT NULL AND p_endpoint !~ '^crun:[A-Za-z0-9._/-]{1,120}$')",
      () => "(p_endpoint IS NOT NULL AND p_endpoint !~ '^crun:[A-Za-z0-9._/-]{1,120}$' AND p_endpoint NOT IN ('crun:bytedance/seedance2-5-r2v:edit', 'crun:bytedance/seedance2-5-r2v:extend'))")
    .replace('AND breaker_opened_at IS NOT NULL) THEN',
      "AND breaker_opened_at IS NOT NULL AND (p_endpoint = 'crun:suno/music-generate' OR breaker_opened_at > now() - interval '10 minutes')) THEN");
  assert.equal(gate(sql), expected);
  for (const signature of ['job_route_close_refused(uuid, uuid)', 'mark_job_attempt_refused(text, text)', 'mark_job_attempt_outcome(text, text, text)']) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`));
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`));
  }
  assert.equal((sql.match(/SECURITY DEFINER\s+SET search_path\s*=\s*''/g) || []).length, 6);
  assert.match(sql, /REVOKE ALL ON FUNCTION private\.route_breaker_record\(uuid, boolean\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /REVOKE ALL ON FUNCTION private\.route_breaker_record\(uuid, boolean, timestamptz\) FROM PUBLIC, anon, authenticated, service_role/);
  for (const name of ['job_route_close_refused', 'mark_job_attempt_refused']) {
    const body = sql.split(`CREATE OR REPLACE FUNCTION public.${name}(`)[1].split('$$;')[0];
    assert.doesNotMatch(body, /route_breaker_record/);
  }
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION private\.route_breaker_record|UPDATE public\.model_catalog|CREATE OR REPLACE FUNCTION public\.job_route_failover/);
});

test('0603 preserves async outcome handling while forwarding the attempt creation time', () => {
  const read = (name) => readFileSync(new URL(`../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');
  const outcomeFunction = (sql) => sql.match(/CREATE OR REPLACE FUNCTION public\.mark_job_attempt_outcome\([\s\S]*?\$\$;/)[0];
  const sql = read('0603_route_failure_accounting.sql');
  const expected = outcomeFunction(read('0376_route_circuit_breaker.sql'))
    .replace('RETURNING x.route_id', 'RETURNING x.route_id, x.created_at')
    .replace("a.route_id, p_outcome = 'completed');", "a.route_id, p_outcome = 'completed', a.created_at);");
  assert.equal(outcomeFunction(sql), expected);
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

test('a failover attempt (2 or 3) records its supplier id through record_attempt_supplier', async () => {
  const sent = [];
  const call = async (n, a) => { sent.push([n, a]); return { ok: true, updated: 1 }; };
  assert.equal(await recordFirstAttempt({ jobId: 'j1', route: own, attemptNo: 2, providerJobId: 'task_5' }, {}, { call }), true);
  assert.deepEqual(sent, [['record_attempt_supplier', { p_job_id: 'j1', p_attempt_no: 2, p_supplier_job_id: 'task_5' }]]);
});
