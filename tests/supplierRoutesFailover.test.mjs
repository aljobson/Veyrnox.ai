import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifySubmitFailure, countsAgainstRoute, nextRoute, submitWithFailover } from '../lib/supplierRoutesFailover.js';

const R = (id, supplier, priority, extra = {}) => ({ id, supplier, endpoint: `${supplier}:ep`, priority, state: 'active', provenance: 'licensed_reseller', parity_record: 'p', cost_per_unit: 0.02, cost_unit: 'per_generation', ...extra });
const kie = R('r1', 'kie', 1), fal = R('r2', 'fal', 2), grsai = R('r3', 'grsai', 3);
const offer = { id: 'nano-banana-kie', provider: 'kie', provider_endpoint: 'kie:ep' };
const ok = (id) => ({ ok: true, providerJobId: id });
const rejected = (error, extra = {}) => ({ ok: false, outcome: 'rejected', error, ...extra });

function world({ results, hops = {}, check = () => ({ ok: true }), key = () => 'k' } = {}) {
  const log = [], calls = [], submits = [];
  const providers = {};
  for (const name of ['kie', 'fal', 'grsai']) {
    providers[name] = { key, check, submit: async (job) => { submits.push([name, job.provider_endpoint]); return (results[name] || (() => rejected('x')))(); } };
  }
  const deps = {
    providerFor: (n) => providers[n] || null,
    capabilityFor: (ep) => ({ provider: ep.split(':')[0] }),
    rpc: async (name, args) => { calls.push([name, args]); return (hops[args.p_next_route_id ?? 'close'] || { ok: true, attempt_no: 2 }); },
    log: (...a) => log.push(a),
  };
  const run = (over = {}) => submitWithFailover({
    jobId: 'job1', modelRow: offer, ownRoute: kie, routes: [kie, fal, grsai], canHop: true, inputs: {}, jobInputs: {}, publicHost: 'https://x', sources: undefined,
    first: { provider: providers.kie, record: { provider: 'kie' }, key: 'k' }, deps, ...over }, {});
  return { run, calls, submits, log };
}

test('only a provable refusal is routed around', () => {
  for (const r of [rejected('kie 429/429: busy'), rejected('kie 401/401: key'), rejected('kie 403/403'), rejected('fal 429: slow down'), rejected('fal 401: nope'), rejected('x', { errorCode: 'provider_payment_required' })]) {
    assert.equal(classifySubmitFailure(r), 'failover', JSON.stringify(r));
  }
  for (const r of [
    { ok: false, outcome: 'unknown', error: 'transport: reset' }, { ok: false, outcome: 'unknown', error: 'kie 503/503' },
    rejected('kie 422/422: prompt'), rejected('fal 400: bad input'), rejected('fal 422: moderation'), rejected('provider_request_rejected'),
    rejected('kie 500/500'), { ok: true }, null,
  ]) assert.equal(classifySubmitFailure(r), 'stop', JSON.stringify(r));
});

test('the next route skips tried, standby and unproven routes', () => {
  assert.equal(nextRoute([kie, fal], new Set(['r1']))?.id, 'r2');
  assert.equal(nextRoute([kie, { ...fal, state: 'standby' }], new Set(['r1'])), null);
  assert.equal(nextRoute([kie, { ...fal, parity_record: null }], new Set(['r1'])), null);
  assert.equal(nextRoute([kie, fal], new Set(['r1', 'r2'])), null);
});

test('a success on route 1 submits once and never calls the database', async () => {
  const w = world({ results: { kie: () => ok('t1') } });
  const r = await w.run();
  assert.deepEqual([r.result.providerJobId, r.supplier, r.attemptNo], ['t1', 'kie', 1]);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.submits, [['kie', 'kie:ep']]);
});

test('a capacity refusal hops to the next route, which holds the job', async () => {
  const w = world({ results: { kie: () => rejected('kie 429/429: busy'), fal: () => ok('t2') } });
  const r = await w.run();
  assert.deepEqual([r.result.ok, r.supplier, r.route.id, r.attemptNo], [true, 'fal', 'r2', 2]);
  assert.deepEqual(w.calls, [['job_route_failover', { p_job_id: 'job1', p_failed_route_id: 'r1', p_next_route_id: 'r2' }]]);
  assert.deepEqual(w.submits, [['kie', 'kie:ep'], ['fal', 'fal:ep']]);
});

test('an ambiguous answer never hops and is not closed as failed', async () => {
  const w = world({ results: { kie: () => ({ ok: false, outcome: 'unknown', error: 'transport: reset' }) } });
  const r = await w.run();
  assert.equal(r.result.outcome, 'unknown');
  assert.deepEqual(w.submits, [['kie', 'kie:ep']]);
  assert.deepEqual(w.calls, []);
});

test('a local boundary not_sent result neither fails over nor closes the debited attempt', async () => {
  const w = world({ results: { kie: () => ({ ok: false, outcome: 'not_sent', errorCode: 'provider_rate_limited',
    scope: 'deferred', retryable: true }) } });
  const r = await w.run();
  assert.equal(r.result.outcome, 'not_sent');
  assert.deepEqual(w.submits, [['kie', 'kie:ep']]);
  assert.deepEqual(w.calls, []);
  assert.equal(classifySubmitFailure(r.result), 'stop');
});

test('a refused prompt does not hop, and the failed attempt is closed for the refund path', async () => {
  const w = world({ results: { kie: () => rejected('kie 422/422: prompt refused') } });
  const r = await w.run();
  assert.equal(r.result.ok, false);
  assert.deepEqual(w.submits, [['kie', 'kie:ep']]);
  assert.deepEqual(w.calls, [['job_route_close_refused', { p_job_id: 'job1', p_route_id: 'r1' }]]);
});

test('only a supplier-side refusal counts against the route', () => {
  for (const r of [
    rejected('kie 401/401: key'), rejected('fal 429: slow down'), rejected('x', { errorCode: 'provider_payment_required' }),
    rejected('provider_auth_failed', { errorCode: 'provider_auth_failed', scope: 'account' }),
    rejected('provider_rate_limited', { errorCode: 'provider_rate_limited', scope: 'deferred' }),
    rejected('provider_route_unavailable', { errorCode: 'provider_route_unavailable', scope: 'route' }),
    rejected('crun 455/455', { errorCode: 'provider_route_unavailable', scope: 'route' }),
  ]) assert.equal(countsAgainstRoute(r), true, JSON.stringify(r));
  for (const r of [
    rejected('provider_moderation', { errorCode: 'provider_moderation', scope: 'rejected' }),
    rejected('provider_input_rejected', { errorCode: 'provider_input_rejected', scope: 'rejected' }),
    rejected('crun 451/451'), rejected('crun 422/422: reference_rejected'), rejected('kie 422/422: prompt'), rejected('fal 422: moderation'),
    rejected('provider_unavailable', { errorCode: 'provider_unavailable', scope: 'circuit' }),
    rejected('provider_boundary_refused', { errorCode: 'provider_boundary_refused', scope: 'circuit' }),
    rejected('provider_rate_limited', { errorCode: 'provider_rate_limited', scope: 'deferred', localLimit: true }),
    { ok: false, outcome: 'unknown', error: 'kie 503/503' }, { ok: true }, null,
  ]) assert.equal(countsAgainstRoute(r), false, JSON.stringify(r));
});

test('a genuine supplier failure on the last route is closed through the counting path', async () => {
  const w = world({ results: { kie: () => rejected('provider_route_unavailable', { errorCode: 'provider_route_unavailable', scope: 'route' }) } });
  await w.run({ canHop: false });
  assert.deepEqual(w.calls, [['job_route_failover', { p_job_id: 'job1', p_failed_route_id: 'r1', p_next_route_id: null }]]);
});

test('accounting recognizes kie envelope failures without changing hop eligibility', () => {
  for (const error of ['kie 200/401: x', 'kie 200/402', 'kie 200/403', 'kie 200/429', 'kie 200/455', 'kie 200/500', 'kie 200/599: x']) {
    assert.equal(countsAgainstRoute(rejected(error)), true, error);
    assert.equal(classifySubmitFailure(rejected(error)), 'stop', error);
  }
  for (const error of ['kie 200/422: x', 'kie 200/4010', 'kie 200/429 extra', 'kie 20/500', 'crun 200/500', 'provider_request_rejected']) {
    assert.equal(countsAgainstRoute(rejected(error)), false, error);
  }
});

test('scope-free GrsAI and OpenRouter supplier codes count only for rejected submissions', async () => {
  for (const supplier of ['grsai', 'openrouter']) {
    for (const errorCode of ['provider_auth_failed', 'provider_payment_required', 'provider_rate_limited', 'provider_model_unavailable']) {
      const result = rejected(errorCode, { errorCode });
      assert.equal(countsAgainstRoute(result), true, `${supplier}: ${errorCode}`);
      assert.equal(classifySubmitFailure(result), errorCode === 'provider_payment_required' ? 'failover' : 'stop');
      assert.equal(countsAgainstRoute({ ...result, localLimit: true }), false);
      for (const outcome of [undefined, 'unknown', 'deferred', 'not_sent']) {
        assert.equal(countsAgainstRoute({ ...result, outcome }), false);
      }
      const calls = [];
      await submitWithFailover({ jobId: 'j', modelRow: { ...offer, provider: supplier }, ownRoute: kie, routes: [kie],
        canHop: false, first: { provider: { submit: async () => result } },
        deps: { rpc: async (...args) => { calls.push(args); return { ok: true }; } },
      }, {});
      assert.deepEqual(calls, [['job_route_failover', { p_job_id: 'j', p_failed_route_id: 'r1', p_next_route_id: null }, {}]]);
    }
  }
  for (const errorCode of ['provider_request_rejected', 'provider_unavailable', 'provider_refused', 'provider_auth_failed_extra']) {
    assert.equal(countsAgainstRoute(rejected(errorCode, { errorCode })), false, errorCode);
  }
});

test('fal and Higgsfield payment refusals count without changing hop eligibility', async () => {
  for (const error of ['fal 402: insufficient balance', 'higgsfield 402/rejected']) {
    const result = rejected(error);
    assert.equal(countsAgainstRoute(result), true, error);
    assert.equal(classifySubmitFailure(result), 'stop', error);
    assert.equal(countsAgainstRoute({ ...result, localLimit: true }), false);
    for (const outcome of [undefined, 'unknown', 'deferred', 'not_sent']) {
      assert.equal(countsAgainstRoute({ ...result, outcome }), false);
    }
    const w = world({ results: { kie: () => result } });
    assert.equal((await w.run()).result, result);
    assert.deepEqual(w.calls, [['job_route_failover', { p_job_id: 'job1', p_failed_route_id: 'r1', p_next_route_id: null }]]);
  }
  for (const error of ['upstream_error', 'fal 4020: x', 'Fal 402: x', ' fal 402: x', 'higgsfield 402: x', 'higgsfield 4020/402']) {
    assert.equal(countsAgainstRoute(rejected(error)), false, error);
    assert.equal(classifySubmitFailure(rejected(error)), 'stop', error);
  }
});

test('submit refusal closure errors log once without counting, including a missing RPC', async () => {
  const errors = [
    { status: 404, body: { code: 'PGRST202' } },
    { status: 500, body: { code: 'PGRST202' } },
    { status: '404', body: { code: 'PGRST202' } },
    { status: 404, body: { code: 'PGRST205' } },
    { status: 404 }, new Error('network error'),
  ];
  for (const error of errors) {
    const calls = [], logs = [];
    const result = rejected('kie 200/422: x');
    const w = world({ results: { kie: () => result } });
    const returned = await w.run({ canHop: false, deps: {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'job_route_close_refused') throw error;
        return { ok: true };
      }, log: (...args) => logs.push(args),
    } });
    assert.equal(returned.result, result);
    assert.deepEqual(calls, [
      ['job_route_close_refused', { p_job_id: 'job1', p_route_id: 'r1' }],
    ]);
    assert.equal(logs.length, 1);
  }
});

test('submit accounting without an outcome stays unchanged for BytePlus', async () => {
  const result = { ok: false, errorCode: 'provider_auth_failed' };
  const w = world({ results: { kie: () => result } });
  assert.equal(countsAgainstRoute(result), false);
  assert.equal((await w.run({ modelRow: { ...offer, provider: 'byteplus' } })).result, result);
  assert.deepEqual(w.calls, []);
});

test('a second refusal hops again, then stops at three attempts and closes the last', async () => {
  const w = world({
    results: { kie: () => rejected('kie 429/429'), fal: () => rejected('fal 429: busy'), grsai: () => rejected('fal 429: busy') },
    hops: { r2: { ok: true, attempt_no: 2 }, r3: { ok: true, attempt_no: 3 } },
  });
  const r = await w.run();
  assert.equal(r.result.ok, false);
  assert.deepEqual(w.submits.map((x) => x[0]), ['kie', 'fal', 'grsai']);
  assert.equal(r.attemptNo, 3);
  assert.deepEqual(w.calls[w.calls.length - 1], ['job_route_failover', { p_job_id: 'job1', p_failed_route_id: 'r3', p_next_route_id: null }]);
});

test('a database refusal stops or skips: terminal codes stop, others try the next candidate', async () => {
  const stop = world({ results: { kie: () => rejected('kie 429/429') }, hops: { r2: { ok: false, code: 'job_not_failable_over' } } });
  assert.equal((await stop.run()).supplier, 'kie');
  assert.deepEqual(stop.submits.map((x) => x[0]), ['kie']);
  const skip = world({ results: { kie: () => rejected('kie 429/429'), grsai: () => ok('t3') }, hops: { r2: { ok: false, code: 'spend_limit' }, r3: { ok: true, attempt_no: 2 } } });
  const r = await skip.run();
  assert.deepEqual([r.supplier, r.result.ok], ['grsai', true]);
});

test('a next route that cannot be built is skipped before the database is touched', async () => {
  const w = world({ results: { kie: () => rejected('kie 429/429') }, key: (...a) => null });
  const r = await w.run({ first: { provider: { submit: async () => rejected('kie 429/429') }, record: {}, key: 'k' } });
  assert.equal(r.result.ok, false);
  assert.deepEqual(w.calls.filter((c) => c[1].p_next_route_id), []);
});

test('no hop for media-input jobs, or without a route set; one submit, as before', async () => {
  const media = world({ results: { kie: () => rejected('kie 429/429') } });
  await media.run({ canHop: false });
  assert.deepEqual(media.submits.map((x) => x[0]), ['kie']);
  const off = world({ results: { kie: () => rejected('kie 429/429') } });
  await off.run({ ownRoute: null, routes: [] });
  assert.deepEqual(off.submits.map((x) => x[0]), ['kie']);
  assert.deepEqual(off.calls, []);
});

test('the route submits through submitWithFailover and records the supplier that holds the job', () => {
  const src = readFileSync(new URL('../lib/generationProviderSubmit.js', import.meta.url), 'utf8');
  assert.match(src, /const submitted = await submitWithFailover\(/);
  assert.match(src, /provider: servedBy, providerJobId: submitResult\.providerJobId/);
  assert.match(src, /attemptNo: submitted\.attemptNo/);
  assert.doesNotMatch(src, /await provider\.submit\(/);
  assert.match(src, /submitResult\.outcome === 'not_sent'/);
  assert.match(src, /retryable: true/);
});

test('typed auth and rate refusals fail over only when the Crun adapter marked the result', () => {
  for (const errorCode of ['provider_auth_failed', 'provider_rate_limited']) {
    assert.equal(classifySubmitFailure({ ok: false, outcome: 'rejected', errorCode }), 'stop', `${errorCode} from another supplier keeps stopping`);
    assert.equal(classifySubmitFailure({ ok: false, outcome: 'rejected', errorCode, scope: 'account' }), 'failover');
  }
  assert.equal(classifySubmitFailure({ ok: false, outcome: 'rejected', errorCode: 'provider_payment_required' }), 'failover');
});
