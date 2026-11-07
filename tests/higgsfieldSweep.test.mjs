import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sweepHiggsfield, BATCH, TIMEOUT_MINUTES } from '../lib/higgsfieldSweep.js';
import { providerFor } from '../packages/provider-sdk/registry.js';
import { capabilityFor } from '../lib/modelCapabilities.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' };
const r2cfg = { accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' };
const now = new Date('2026-10-24T12:00:00Z');
const job = (id, state = 'SUBMITTED', age = 1) => ({ id, user_id: 'owner', credits: 9, state, provider_job_id: `task-${id}`, created_at: new Date(+now - age * 60000).toISOString() });
const args = { cfg, r2cfg, apiKey: 'test-key', now };
const ROUTES = [
  { model_id: 'kling-3.0-i2v-kie', endpoint: 'higgsfield:kling-video/v3.0/pro/image-to-video' },
  { model_id: 'stray', endpoint: 'kie:not-ours' },
];
async function withRows(rows, run, routes = ROUTES) {
  const real = globalThis.fetch; const urls = [];
  globalThis.fetch = async (url) => { urls.push(new URL(url)); return Response.json(new URL(url).pathname.endsWith('/model_routes') ? routes : rows); };
  try { await run(urls); } finally { globalThis.fetch = real; }
}

test('polling needs the database, the key and R2 before any read', async () => {
  await withRows([], async (urls) => {
    for (const over of [{ apiKey: '' }, { cfg: {} }, { r2cfg: {} }]) assert.deepEqual(await sweepHiggsfield({ ...args, ...over }), { skipped: 'not_configured' });
    assert.equal(urls.length, 0);
  });
});

test('only models with a Higgsfield route this adapter owns are swept, selected by the job\'s provider', async () => {
  await withRows([], async (urls) => {
    assert.deepEqual(await sweepHiggsfield({ ...args, read: async () => assert.fail('no jobs, no reads') }), { checked: 0, applied: 0, pending: 0, errors: 0 });
    const q = urls.find((u) => u.pathname.endsWith('/jobs')).searchParams;
    assert.match(q.get('provider'), /^eq\.higgsfield$/);
    assert.equal(q.get('model_id'), 'in.(kling-3.0-i2v-kie)');
  });
  await withRows([], async () => assert.deepEqual(await sweepHiggsfield({ ...args }), { skipped: 'no_routes' }), [{ model_id: 'x', endpoint: 'kie:not-ours' }]);
});

test('a finished clip completes through the shared path as an MP4 from source higgsfield', async () => {
  const calls = [];
  await withRows([job('a')], async () => {
    const out = await sweepHiggsfield({ ...args, read: async () => ({ ok: true, state: 'success', outputUrl: 'https://tempfile.mediaoss.bar/a.mp4' }),
      complete: async (x) => { calls.push(x); return { status: 200, body: { ok: true } }; } });
    assert.deepEqual(out, { checked: 1, applied: 1, pending: 0, errors: 0 });
  });
  assert.equal(calls[0].source, 'higgsfield');
  assert.equal(calls[0].ext, '.mp4');
  assert.equal(calls[0].providerJobId, 'task-a');
  assert.equal(calls[0].copyOptions.expectMp4, true);
});

test('pending waits, a failure refunds through completeJob, a long pending job times out', async () => {
  const seen = [];
  await withRows([job('p'), job('f'), job('t', 'SUBMITTED', TIMEOUT_MINUTES + 5)], async () => {
    const out = await sweepHiggsfield({ ...args,
      read: async (id) => (id === 'task-f' ? { ok: true, state: 'fail', errorCode: 'provider_failed' } : { ok: true, state: 'pending' }),
      complete: async (x) => { seen.push([x.job.id, x.outcome.state, x.outcome.errorCode]); return { status: 200, body: { ok: true } }; } });
    assert.deepEqual(out, { checked: 3, applied: 2, pending: 1, errors: 0 });
  });
  assert.deepEqual(seen, [['f', 'fail', 'provider_failed'], ['t', 'fail', 'provider_timeout']]);
});

test('a read error is retried next tick and never completes or refunds the job', async () => {
  await withRows([job('e')], async () => {
    const out = await sweepHiggsfield({ ...args, read: async () => ({ ok: false, error: 'higgsfield 503' }), complete: async () => assert.fail('must not complete') });
    assert.deepEqual(out, { checked: 1, applied: 0, pending: 0, errors: 1 });
  });
  assert.equal(BATCH, 50);
});


test('five polls at a time and one copy at a time; failed jobs recover without another supplier read', async () => {
  let reads = 0, peakReads = 0, copies = 0, peakCopies = 0;
  const rows = Array.from({ length: 12 }, (_, i) => job(String(i)));
  rows.push(job('failed', 'FAILED'));
  await withRows(rows, async () => {
    const out = await sweepHiggsfield({ ...args, read: async (id) => {
      assert.notEqual(id, 'task-failed');
      peakReads = Math.max(peakReads, ++reads);
      await new Promise(resolve => setTimeout(resolve, 1)); reads--;
      return { ok: true, state: 'success', outputUrl: 'https://unknown.test/v.mp4' };
    }, complete: async () => {
      peakCopies = Math.max(peakCopies, ++copies);
      await new Promise(resolve => setTimeout(resolve, 1)); copies--;
      return { status: 200, body: { ok: true } };
    } });
    assert.equal(out.applied, 13);
  });
  assert.equal(peakReads, 5);
  assert.equal(peakCopies, 1);
});

test('copy warnings and thrown reads are retried rather than counted as applied', async () => {
  await withRows([job('copy'), job('read')], async () => {
    const out = await sweepHiggsfield({ ...args, read: async (id) => {
      if (id === 'task-read') throw new Error('read unavailable');
      return { ok: true, state: 'success', outputUrl: 'https://unknown.test/v.mp4' };
    }, complete: async () => ({ status: 200, body: { warn: 'asset_store_failed' } }) });
    assert.deepEqual(out, { checked: 2, applied: 0, pending: 0, errors: 2 });
  });
});

test('registry key needs exact true and R2; both capability records match the adapter', () => {
  const names = ['HIGGSFIELD_ENABLED', 'HIGGSFIELD_API_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const before = names.map(name => process.env[name]);
  const provider = providerFor('higgsfield');
  assert.ok(provider);
  try {
    for (const name of names) delete process.env[name];
    process.env.HIGGSFIELD_API_KEY = 'test-key';
    for (const flag of [undefined, 'false', 'TRUE', '1', 'true']) {
      if (flag === undefined) delete process.env.HIGGSFIELD_ENABLED; else process.env.HIGGSFIELD_ENABLED = flag;
      assert.equal(provider.key(), null);
    }
    Object.assign(process.env, { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd' });
    assert.equal(provider.key(), 'test-key');
    for (const flag of [undefined, 'false', 'TRUE', '1']) {
      if (flag === undefined) delete process.env.HIGGSFIELD_ENABLED; else process.env.HIGGSFIELD_ENABLED = flag;
      assert.equal(provider.key(), null, 'absent or non-true stays off even with key and R2 configured');
    }
  } finally { names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; }); }
  for (const model of ['kling-video/v3.0/pro/image-to-video', 'kling-video/v2.6/pro/text-to-video']) {
    const endpoint = `higgsfield:${model}`;
    const record = capabilityFor(endpoint);
    assert.equal(record.provider, 'higgsfield');
    assert.equal(record.inputs.prompt.max, 2500);
    assert.equal(record.fixed.sound, 'off');
    const inputs = { prompt: 'boat' };
    if (model.includes('image-to-video')) {
      Object.assign(inputs, { image_url: 'https://image.test/v.png' });
      assert.equal(record.media.image.field, 'image_url');
      assert.equal(record.media.image.list, false);
      assert.equal(record.media.image.max, 1);
      assert.equal(record.fixed.multi_shots, false);
    }
    assert.equal(provider.check(record, { provider_endpoint: endpoint }, inputs).ok, true);
  }
  assert.equal(provider.check({}, { provider_endpoint: 'higgsfield:unknown' }, {}).error, 'provider_unsupported');
});

test('cron and gateway are wired while flag and output hosts remain dark', async () => {
  const worker = readFileSync('worker.js', 'utf8');
  assert.match(worker, /env\.HIGGSFIELD_ENABLED === 'true' \? \[sweepHiggsfield\(/);
  assert.match(worker, /apiKey: env\.HIGGSFIELD_API_KEY/);
  // Absent means off; no binding is added to the production 66-var budget.
  assert.doesNotMatch(readFileSync('wrangler.jsonc', 'utf8'), /HIGGSFIELD_ENABLED/);
  assert.match(readFileSync('lib/generationProviderSubmit.js', 'utf8'), /'crun', 'higgsfield'\]\.includes\(servedBy\)/);
  assert.match(readFileSync('lib/generationProviderSubmit.js', 'utf8'), /canHop: !rawKeys\.length && !rawAssets\.length && !record\.edit/);
  assert.doesNotMatch(readFileSync('packages/adapters/r2Copy.js', 'utf8'), /higgsfield/i);
  const { copyUrlToR2 } = await import('../packages/adapters/r2Copy.js');
  const real = globalThis.fetch, quiet = console.error;
  globalThis.fetch = async () => assert.fail('unverified Higgsfield output must never be fetched');
  console.error = () => {};
  try { assert.equal((await copyUrlToR2('https://unknown.test/v.mp4', 'k', {}, { provider: 'higgsfield' })).error, 'source host not allowed'); }
  finally { globalThis.fetch = real; console.error = quiet; }
});
