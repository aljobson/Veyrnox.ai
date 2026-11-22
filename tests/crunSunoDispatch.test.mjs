import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { submitCrunAtBoundary } from '../lib/crunSubmitBoundary.js';
import { crunDeferredRetrySeconds, runCrunDispatchAttempt, runCrunDispatch, validCrunClaim } from '../lib/crunDispatch.js';
import { sweepCrunSunoMusic, SUNO_PENDING_ALERT_MINUTES } from '../lib/crunSunoSweep.js';
import { paceCrunTaskInfo, resetCrunPollPacer } from '../lib/crunPollPacer.js';
import { providerFor } from '../packages/provider-sdk/registry.js';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service' };
const r2cfg = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };
const claim = (over = {}) => ({
  job_id: uuid(1), attempt_token: uuid(2), endpoint: 'crun:suno/music-generate',
  payload: { model: 'suno/music-generate', input: { mode: 'simple', prompt: 'rain', instrumental: false, suno_model: 'v6' } },
  ...over,
});

test('generic and music submissions share the one database CreateTask window and circuit refusal', async () => {
  let slots = 0, submits = 0;
  const rpc = async (name) => {
    assert.equal(name, 'reserve_crun_create_slot');
    slots += 1;
    return slots === 1 ? { ok: true } : { ok: false, code: 'CRUN_RATE_LIMITED', retry_after_seconds: 7 };
  };
  const submit = async () => { submits += 1; return { ok: true, providerJobId: 'task-1' }; };
  const generic = await submitCrunAtBoundary({ job_id: uuid(3), provider_endpoint: 'crun:google/veo3-1-lite-t2v', inputs: { prompt: 'x' } }, {
    apiKey: 'key', cfg, reservationKey: `generic:${uuid(3)}`, purpose: 'generic.create', rpc, submit,
  });
  const music = await submitCrunAtBoundary({ job_id: uuid(4), provider_endpoint: 'crun:suno/music-generate', inputs: { prompt: 'y' } }, {
    apiKey: 'key', cfg, reservationKey: `music:${uuid(5)}`, purpose: 'music.create', rpc, submit,
  });
  assert.equal(generic.ok, true);
  assert.deepEqual(music, { ok: false, outcome: 'rejected', error: 'provider_rate_limited',
    errorCode: 'provider_rate_limited', scope: 'deferred', retryAfterSeconds: 7, localLimit: true });
  assert.equal(submits, 1);

  for (const purpose of ['generic.create', 'music.create']) {
    const held = await submitCrunAtBoundary({ job_id: uuid(6), provider_endpoint: 'crun:suno/music-generate', inputs: {} }, {
      apiKey: 'key', cfg, reservationKey: `${purpose}:${uuid(6)}`, purpose,
      rpc: async () => ({ ok: false, code: 'CRUN_UNAVAILABLE' }), submit: async () => assert.fail('circuit must prevent submit'),
    });
    assert.equal(held.scope, 'circuit');
  }
});

test('each generic Crun submit attempt consumes a distinct limiter reservation', async (t) => {
  const keys = [];
  const keep = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY];
  process.env.SUPABASE_URL = 'https://db.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  t.after(() => {
    for (const [name, value] of [['SUPABASE_URL', keep[0]], ['SUPABASE_SERVICE_ROLE_KEY', keep[1]]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/rpc/reserve_crun_create_slot')) {
      keys.push(JSON.parse(init.body).p_reservation_key);
      return Response.json({ ok: true });
    }
    return Response.json({ code: 200, data: { task_id: `task-${keys.length}` } });
  });
  const provider = providerFor('crun');
  const job = { job_id: uuid(30), provider_endpoint: 'crun:google/veo3-1-lite-t2v', inputs: { prompt: 'x' } };
  assert.equal((await provider.submit(job, {}, 'key')).ok, true);
  assert.equal((await provider.submit(job, {}, 'key')).ok, true);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test('the boundary trips the Suno endpoint breaker with sanitized evidence', async () => {
  const calls = [];
  const result = await submitCrunAtBoundary({ job_id: uuid(1), provider_endpoint: 'crun:suno/music-generate', inputs: {} }, {
    apiKey: 'key', cfg, reservationKey: `music:${uuid(2)}`, purpose: 'music.create',
    rpc: async (name, args) => { calls.push([name, args]); return { ok: true }; },
    submit: async () => ({ ok: false, outcome: 'rejected', errorCode: 'provider_route_unavailable', scope: 'route' }),
    now: () => '2026-11-22T12:00:00.000Z',
  });
  assert.equal(result.scope, 'route');
  assert.deepEqual(calls.map(([name]) => name), ['reserve_crun_create_slot', 'trip_crun_endpoint_routes']);
  assert.deepEqual(calls[1][1], { p_endpoint: 'crun:suno/music-generate', p_observed_at: '2026-11-22T12:00:00.000Z' });
});

test('an account refusal pauses the shared circuit with fenced sanitized evidence', async () => {
  const calls = [];
  await submitCrunAtBoundary({ job_id: uuid(1), provider_endpoint: 'crun:suno/music-generate', inputs: {} }, {
    apiKey: 'key', cfg, reservationKey: `music:${uuid(2)}`, purpose: 'music.create',
    rpc: async (name, args) => { calls.push([name, args]); return { ok: true, fence: 3 }; },
    submit: async () => ({ ok: false, outcome: 'rejected', errorCode: 'provider_auth_failed', scope: 'account' }),
    now: () => '2026-11-22T12:00:00.000Z',
  });
  assert.deepEqual(calls.map(([name]) => name), ['reserve_crun_create_slot', 'pause_crun_account_admission']);
  assert.deepEqual(calls[1][1], { p_reason: 'provider_auth_failed', p_observed_at: '2026-11-22T12:00:00.000Z' });
});

test('TaskInfo pacing reserves a database slot and fails closed on an unavailable RPC', async () => {
  resetCrunPollPacer(); const calls = [];
  assert.equal(await paceCrunTaskInfo({ cfg, reservationKey: 'taskinfo:fixture-1', wait: async () => {},
    rpc: async (name, args) => { calls.push([name, args]); return { ok: true }; } }), true);
  assert.equal(calls[0][0], 'reserve_crun_taskinfo_slot');
  resetCrunPollPacer();
  assert.equal(await paceCrunTaskInfo({ cfg, reservationKey: 'taskinfo:fixture-2', wait: async () => {},
    rpc: async () => { throw new Error('db unavailable'); } }), false);
});

test('a fenced music attempt submits once and records accepted, deferred, ready, rejected, or unknown', async () => {
  const cases = [
    [{ ok: true, providerJobId: 'task-a' }, 'ACCEPTED'],
    [{ ok: false, outcome: 'rejected', errorCode: 'provider_rate_limited', scope: 'deferred', retryAfterSeconds: 9 }, 'DEFERRED'],
    [{ ok: false, outcome: 'rejected', errorCode: 'provider_auth_failed', scope: 'account' }, 'READY'],
    [{ ok: false, outcome: 'rejected', errorCode: 'provider_input_rejected', scope: 'rejected' }, 'REJECTED'],
    [{ ok: false, outcome: 'unknown', errorCode: 'provider_unreachable' }, 'UNKNOWN'],
  ];
  for (const [answer, expected] of cases) {
    let submits = 0; const calls = [];
    const rpc = async (name, args) => { calls.push([name, args]); return { ok: true }; };
    const result = await runCrunDispatchAttempt(claim(), { apiKey: 'key', cfg }, {
      rpc, boundary: async () => { submits += 1; return answer; },
    });
    assert.equal(submits, 1, expected);
    const record = calls.find(([name]) => name === 'record_crun_dispatch')[1];
    assert.equal(record.p_outcome, expected);
    assert.equal(record.p_provider_job_id, expected === 'ACCEPTED' ? 'task-a' : null);
    if (expected === 'DEFERRED') assert.equal(record.p_retry_after_seconds, 30);
    assert.equal(result.outcome, expected);
  }
});

test('deferred retry backoff is progressive and capped', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map((n) => crunDeferredRetrySeconds(n, 9)), [30, 60, 120, 240, 600]);
  assert.equal(crunDeferredRetrySeconds(0, 45), 45);
});

test('lost evidence never repeats a paid CreateTask and stale STARTED remains recoverable', async () => {
  let submits = 0, records = 0; const alerts = [];
  const rpc = async (name) => {
    if (name === 'record_crun_dispatch') { records += 1; throw new Error('evidence outage'); }
    return { ok: true };
  };
  const quiet = console.error; console.error = (line) => alerts.push(JSON.parse(line));
  try {
    const out = await runCrunDispatchAttempt(claim(), { apiKey: 'key', cfg }, {
      rpc, boundary: async () => { submits += 1; return { ok: true, providerJobId: 'paid-task' }; },
    });
    assert.equal(out.recorded, false);
  } finally { console.error = quiet; }
  assert.equal(submits, 1);
  assert.equal(records, 2, 'only identical evidence is retried');
  assert.equal(alerts.find((entry) => entry.event === 'crun.dispatch_evidence_alert')?.provider_job_id, 'paid-task');
});

test('the minute backstop recovers, claims untargeted work, and stops on an empty queue', async () => {
  const calls = []; let claimed = false;
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'recover_crun_dispatch') return { ok: true };
    if (name === 'claim_crun_dispatch') { if (claimed) return null; claimed = true; return claim(); }
    if (name === 'record_crun_dispatch') return { ok: true };
    if (name === 'reserve_crun_create_slot') return { ok: true };
    if (name === 'record_worker_task_health') return null;
    throw new Error(name);
  };
  const out = await runCrunDispatch({ CRUN_ENABLED: 'true', CRUN_API_KEY: 'key', SUPABASE_URL: cfg.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: cfg.serviceRoleKey }, { rpc, submit: async () => ({ ok: true, providerJobId: 'task-a' }) });
  assert.deepEqual(out, { ok: true, submitted: 1, failed: 0 });
  assert.ok(validCrunClaim(claim()));
  assert.equal(validCrunClaim(claim({ payload: { model: 'other', input: {} } })), false);
  assert.equal(calls.filter(([name]) => name === 'claim_crun_dispatch').length, 2);
});

test('a partial recovery result alerts but cannot poison every later claim', async () => {
  let recoveries = 0, claimed = false;
  const quiet = console.error; console.error = () => {};
  try {
    const out = await runCrunDispatch({ CRUN_ENABLED: 'true', CRUN_API_KEY: 'key', SUPABASE_URL: cfg.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: cfg.serviceRoleKey }, { rpc: async (name) => {
      if (name === 'recover_crun_dispatch') return ++recoveries === 1 ? { ok: false, failed: 1 } : { ok: true };
      if (name === 'claim_crun_dispatch') { if (claimed) return null; claimed = true; return claim(); }
      if (name === 'reserve_crun_create_slot' || name === 'record_crun_dispatch') return { ok: true };
      throw new Error(name);
    }, submit: async () => ({ ok: true, providerJobId: 'task-after-poison' }) });
    assert.equal(out.submitted, 1);
  } finally { console.error = quiet; }
});

test('an invalid claimed payload is fenced closed without a paid submission', async () => {
  const records = []; let claimed = false;
  const quiet = console.error; console.error = () => {};
  try {
    const out = await runCrunDispatch({ CRUN_ENABLED: 'true', CRUN_API_KEY: 'key', SUPABASE_URL: cfg.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: cfg.serviceRoleKey }, { rpc: async (name, args) => {
      if (name === 'recover_crun_dispatch') return { ok: true };
      if (name === 'claim_crun_dispatch') { if (claimed) return null; claimed = true; return claim({ endpoint: 'crun:wrong' }); }
      if (name === 'record_crun_dispatch') { records.push(args); return { ok: true }; }
      throw new Error(name);
    }, submit: async () => assert.fail('invalid claim must not submit') });
    assert.deepEqual(out, { ok: false, submitted: 0, failed: 1 });
  } finally { console.error = quiet; }
  assert.equal(records[0].p_outcome, 'REJECTED');
  assert.equal(records[0].p_failure_code, 'dispatch_payload_invalid');
});

function settlementRows(jobOverrides = {}, dispatchOverrides = {}) {
  const now = new Date('2026-11-22T12:00:00.000Z');
  const job = { id: uuid(10), user_id: uuid(11), credits: 4, state: 'SUBMITTED', provider_job_id: 'task-suno',
    created_at: new Date(+now - 10 * 60_000).toISOString(), updated_at: new Date(+now - 60_000).toISOString(),
    model_id: 'ace-step', provider: 'crun', ...jobOverrides };
  const dispatch = { job_id: job.id, state: 'ACCEPTED', provider_job_id: job.provider_job_id,
    created_at: job.created_at, last_authoritative_status: 'pending', ...dispatchOverrides };
  return { now, listJobs: async () => [job], select: async () => [dispatch] };
}

test('Suno settlement refunds only authoritative failure; unreadable and old pending remain held', async () => {
  for (const [read, expected, expectedCalls] of [
    [async () => ({ ok: false, errorCode: 'provider_status_unavailable' }), { checked: 1, applied: 0, pending: 0, errors: 1 }, []],
    [async () => ({ ok: true, state: 'pending' }), { checked: 1, applied: 0, pending: 1, errors: 0 }, ['record_crun_task_status']],
  ]) {
    const rows = settlementRows({ created_at: new Date(Date.parse('2026-11-22T12:00:00.000Z') - (SUNO_PENDING_ALERT_MINUTES + 1) * 60_000).toISOString() });
    const calls = []; const quiet = console.error; console.error = () => {};
    try {
      assert.deepEqual(await sweepCrunSunoMusic({ cfg, r2cfg, apiKey: 'key', now: rows.now, select: rows.select, listJobs: rows.listJobs,
        rpc: async (name) => { calls.push(name); return { ok: true }; }, read, pace: async () => {},
        copy: async () => assert.fail('held tasks never copy') }), expected);
    } finally { console.error = quiet; }
    assert.deepEqual(calls, expectedCalls);
  }
  const rows = settlementRows(); const calls = [];
  const failed = await sweepCrunSunoMusic({ cfg, r2cfg, apiKey: 'key', now: rows.now, select: rows.select, listJobs: rows.listJobs,
    rpc: async (name, args) => { calls.push([name, args]); return { ok: true }; },
    read: async () => ({ ok: true, state: 'fail', errorCode: 'provider_task_failed' }), pace: async () => {} });
  assert.equal(failed.applied, 1);
  assert.deepEqual(calls.map(([name]) => name), ['record_crun_task_status', 'record_crun_task_failure']);
});

test('successful Suno audio stores the detected real MIME; copy failures retry then terminate explicitly', async () => {
  const rows = settlementRows(); const calls = [];
  const success = await sweepCrunSunoMusic({ cfg, r2cfg, apiKey: 'key', now: rows.now, select: rows.select, listJobs: rows.listJobs,
    rpc: async (name, args) => { calls.push([name, args]); return { ok: true }; },
    read: async () => ({ ok: true, state: 'success', outputUrl: 'https://verified.invalid/song.bin' }), pace: async () => {},
    copy: async (_url, _key, _cfg, options) => {
      assert.equal(options.expectAudio, true);
      return { ok: true, r2Key: 'crun/task/song.audio', mimeType: 'audio/flac', size: 123, sha256: 'a'.repeat(64) };
    } });
  assert.equal(success.applied, 1);
  assert.equal(calls.find(([name]) => name === 'job_stored')[1].p_mime_type, 'audio/flac');

  const aged = settlementRows({ state: 'SUCCEEDED', updated_at: new Date(+rows.now - 46 * 60_000).toISOString() });
  const terminal = []; const quiet = console.error; console.error = () => {};
  try {
    const out = await sweepCrunSunoMusic({ cfg, r2cfg, apiKey: 'key', now: aged.now, select: aged.select, listJobs: aged.listJobs,
      rpc: async (name) => { terminal.push(name); return { ok: true }; },
      read: async () => ({ ok: true, state: 'success', outputUrl: 'https://unverified.invalid/song.mp3' }), pace: async () => {},
      copy: async () => ({ ok: false, error: 'source host not allowed' }) });
    assert.deepEqual(out, { checked: 1, applied: 0, pending: 0, errors: 1 });
  } finally { console.error = quiet; }
  assert.deepEqual(terminal, ['record_crun_task_status'], 'status is durable while an unverified audio host stays held');

  const exhausted = []; console.error = () => {};
  try {
    const out = await sweepCrunSunoMusic({ cfg, r2cfg, apiKey: 'key', now: aged.now, select: aged.select, listJobs: aged.listJobs,
      rpc: async (name) => { exhausted.push(name); return { ok: true }; },
      read: async () => ({ ok: true, state: 'success', outputUrl: 'https://verified.invalid/song.mp3' }), pace: async () => {},
      copy: async () => ({ ok: false, error: 'source too large' }) });
    assert.equal(out.applied, 1);
  } finally { console.error = quiet; }
  assert.deepEqual(exhausted, ['record_crun_task_status', 'record_crun_asset_failure']);

  const unknownAudio = []; console.error = () => {};
  try {
    const out = await sweepCrunSunoMusic({ cfg, r2cfg, apiKey: 'key', now: aged.now, select: aged.select, listJobs: aged.listJobs,
      rpc: async (name) => { unknownAudio.push(name); return { ok: true }; },
      read: async () => ({ ok: true, state: 'success', outputUrl: 'https://verified.invalid/song.bin' }), pace: async () => {},
      copy: async () => ({ ok: false, error: 'source not audio' }) });
    assert.deepEqual(out, { checked: 1, applied: 0, pending: 0, errors: 1 });
  } finally { console.error = quiet; }
  assert.deepEqual(unknownAudio, ['record_crun_task_status'], 'an unknown audio container requires operator evidence and never auto-refunds');

  const transient = []; console.error = () => {};
  try {
    const out = await sweepCrunSunoMusic({ cfg, r2cfg, apiKey: 'key', now: aged.now, select: aged.select, listJobs: aged.listJobs,
      rpc: async (name) => { transient.push(name); return { ok: true }; },
      read: async () => ({ ok: true, state: 'success', outputUrl: 'https://verified.invalid/song.mp3' }), pace: async () => {},
      copy: async () => ({ ok: false, error: 'fetch source: timeout' }) });
    assert.deepEqual(out, { checked: 1, applied: 0, pending: 0, errors: 1 });
  } finally { console.error = quiet; }
  assert.deepEqual(transient, ['record_crun_task_status'], 'transient copy failures never auto-refund accepted work');
});

test('music route chooses wakeup by frozen contract and skips every replay wakeup', () => {
  const route = readFileSync(new URL('../app/api/v1/music/generations/route.js', import.meta.url), 'utf8');
  assert.match(route, /result\.provider_contract === 'crun-suno-v1'/);
  assert.match(route, /publishCrunDispatchWakeup/);
  assert.match(route, /result\.idempotent && result\.provider_contract === 'crun-suno-v1'/);
  assert.match(route, /result\?\.code === 'MUSIC_UNAVAILABLE'/);
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(worker, /runCrunDispatch\(env\)/);
  assert.match(worker, /sweepCrunSunoMusic\(/);
});
