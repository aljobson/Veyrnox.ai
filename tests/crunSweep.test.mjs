import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sweepCrun, BATCH, TIMEOUT_MINUTES } from '../lib/crunSweep.js';
import { providerFor } from '../packages/provider-sdk/registry.js';
import { capabilityFor } from '../lib/modelCapabilities.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' };
const r2cfg = { accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' };
const now = new Date('2026-10-24T12:00:00Z');
const job = (id, state = 'SUBMITTED', age = 1) => ({ id, user_id: 'owner', credits: 9, state, provider_job_id: `task-${id}`, created_at: new Date(+now - age * 60000).toISOString() });
const args = { cfg, r2cfg, apiKey: 'test-key', now };
const ROUTES = [
  { model_id: 'veo-3.1-lite-kie', endpoint: 'crun:google/veo3-1-lite-t2v' },
  { model_id: 'stray', endpoint: 'kie:not-ours' },
];
async function withRows(rows, run, routes = ROUTES) {
  const real = globalThis.fetch; const urls = [];
  globalThis.fetch = async (url) => { urls.push(new URL(url)); return Response.json(new URL(url).pathname.endsWith('/model_routes') ? routes : rows); };
  try { await run(urls); } finally { globalThis.fetch = real; }
}

test('polling needs the database, the key and R2 before any read', async () => {
  await withRows([], async (urls) => {
    for (const over of [{ apiKey: '' }, { cfg: {} }, { r2cfg: {} }]) assert.deepEqual(await sweepCrun({ ...args, ...over }), { skipped: 'not_configured' });
    assert.equal(urls.length, 0);
  });
});

test('only models with a Crun route this adapter owns are swept, selected by the job\'s provider', async () => {
  await withRows([], async (urls) => {
    assert.deepEqual(await sweepCrun({ ...args, read: async () => assert.fail('no jobs, no reads') }), { checked: 0, applied: 0, pending: 0, errors: 0 });
    const q = urls.find((u) => u.pathname.endsWith('/jobs')).searchParams;
    assert.match(q.get('provider'), /^eq\.crun$/);
    assert.equal(q.get('model_id'), 'in.(veo-3.1-lite-kie)');
  });
  await withRows([], async () => assert.deepEqual(await sweepCrun({ ...args }), { skipped: 'no_routes' }), [{ model_id: 'x', endpoint: 'kie:not-ours' }]);
});

test('a finished clip completes through the shared path as an MP4 from source crun', async () => {
  const calls = [];
  await withRows([job('a')], async () => {
    const out = await sweepCrun({ ...args, read: async () => ({ ok: true, state: 'success', outputUrl: 'https://tempfile.mediaoss.bar/a.mp4' }),
      complete: async (x) => { calls.push(x); return { status: 200, body: { ok: true } }; } });
    assert.deepEqual(out, { checked: 1, applied: 1, pending: 0, errors: 0 });
  });
  assert.equal(calls[0].source, 'crun');
  assert.equal(calls[0].ext, '.mp4');
  assert.equal(calls[0].providerJobId, 'task-a');
  assert.equal(calls[0].copyOptions.expectMp4, true);
});

test('pending waits, a failure refunds through completeJob, a long pending job times out', async () => {
  const seen = [];
  await withRows([job('p'), job('f'), job('t', 'SUBMITTED', TIMEOUT_MINUTES + 5)], async () => {
    const out = await sweepCrun({ ...args,
      read: async (id) => (id === 'task-f' ? { ok: true, state: 'fail', errorCode: '501' } : { ok: true, state: 'pending' }),
      complete: async (x) => { seen.push([x.job.id, x.outcome.state, x.outcome.errorCode]); return { status: 200, body: { ok: true } }; } });
    assert.deepEqual(out, { checked: 3, applied: 2, pending: 1, errors: 0 });
  });
  assert.deepEqual(seen, [['f', 'fail', '501'], ['t', 'fail', 'provider_timeout']]);
});

test('a read error is retried next tick and never completes or refunds the job', async () => {
  await withRows([job('e')], async () => {
    const out = await sweepCrun({ ...args, read: async () => ({ ok: false, error: 'crun 503' }), complete: async () => assert.fail('must not complete') });
    assert.deepEqual(out, { checked: 1, applied: 0, pending: 0, errors: 1 });
  });
  assert.equal(BATCH, 50);
});

test('Crun is registered but dark: no key without CRUN_ENABLED, with the flag the key needs R2 too', () => {
  const p = providerFor('crun');
  assert.ok(p);
  const keep = { enabled: process.env.CRUN_ENABLED, key: process.env.CRUN_API_KEY };
  try {
    process.env.CRUN_API_KEY = 'k';
    delete process.env.CRUN_ENABLED;
    assert.equal(p.key(), null);
    process.env.CRUN_ENABLED = 'false';
    assert.equal(p.key(), null);
    process.env.CRUN_ENABLED = 'true';
    assert.equal(p.key(), null, 'no R2 configuration in this test environment');
  } finally {
    for (const [name, v] of [['CRUN_ENABLED', keep.enabled], ['CRUN_API_KEY', keep.key]]) { if (v === undefined) delete process.env[name]; else process.env[name] = v; }
  }
});

test('every Crun endpoint has a capability record and the gateway check accepts a plain prompt', () => {
  for (const ep of ['crun:google/veo3-1-lite-t2v', 'crun:google/veo3-1-fast-t2v', 'crun:google/veo3-1-t2v', 'crun:bytedance/seedance2-0-fast-t2v']) {
    assert.equal(capabilityFor(ep)?.provider, 'crun', ep);
    assert.equal(providerFor('crun').check(capabilityFor(ep), { provider_endpoint: ep }, { prompt: 'a boat' }).ok, true, ep);
  }
  assert.equal(providerFor('crun').check({}, { provider_endpoint: 'crun:google/unknown' }, { prompt: 'x' }).error, 'provider_unsupported');
});

test('the cron runs the sweep only when CRUN_ENABLED is "true", and R2 copies only from the observed hosts', () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(worker, /env\.CRUN_ENABLED === 'true' \? \[sweepCrun\(/);
  assert.doesNotMatch(worker, /observeRecovery\('crun'/);
  const r2 = readFileSync(new URL('../packages/adapters/r2Copy.js', import.meta.url), 'utf8');
  assert.match(r2, /crun: \{ hosts: \['tempfile\.mediaoss\.bar', 'static\.mediaoss\.bar'\], suffixes: \[\] \}/);
});

test('an ambiguous Crun submit is held, never refunded: crun is in the guarded list', () => {
  const route = readFileSync(new URL('../app/api/v1/generations/route.js', import.meta.url), 'utf8');
  assert.match(route, /\['fal', 'kie', 'grsai', 'openrouter', 'crun'\]\.includes\(servedBy\)/);
});

test('the R2 copy accepts only Crun\'s two exact output hosts and refuses lookalikes, before any fetch', async () => {
  const { copyUrlToR2 } = await import('../packages/adapters/r2Copy.js');
  const real = globalThis.fetch;
  let fetched = [];
  globalThis.fetch = async (url) => { fetched.push(String(url)); return new Response('x', { status: 403 }); };
  const quiet = console.error; console.error = () => {};
  try {
    for (const host of ['tempfile.mediaoss.bar', 'static.mediaoss.bar']) {
      fetched = [];
      const r = await copyUrlToR2(`https://${host}/v/a.mp4`, 'k', {}, { provider: 'crun' });
      assert.notEqual(r.error, 'source host not allowed', host);
      assert.equal(fetched.length, 1, `${host} is fetched`);
    }
    for (const host of ['mediaoss.bar', 'evil.mediaoss.bar', 'static.mediaoss.bar.evil.test', 'tempfile.mediaoss.bar.example']) {
      fetched = [];
      const r = await copyUrlToR2(`https://${host}/v/a.mp4`, 'k', {}, { provider: 'crun' });
      assert.equal(r.error, 'source host not allowed', host);
      assert.equal(fetched.length, 0, `${host} is never fetched`);
    }
  } finally { globalThis.fetch = real; console.error = quiet; }
});
