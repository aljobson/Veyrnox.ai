import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSwapStore } from '../app/veyrnox/_lib/templateSwapStore.mjs';
import { createSwapActions } from '../app/veyrnox/_lib/templateSwapActions.mjs';
import { barRows, expectedDurationMs } from '../app/veyrnox/_lib/generationProgress.mjs';

// Swap jobs show the same progress bar as every other generation: an accepted
// swap is written to the job history the bar reads, and nothing else is.
const offer = { id: 'test', model: 'kling-o1-reference', credits: 47, name: 'Kling O1' };
const pngs = () => [new Blob(['front'], { type: 'image/png' }), new Blob(['crop'], { type: 'image/png' })];
function setup(gateway) {
  const started = []; let key = 0;
  const store = createSwapStore({ revoke: () => {} }); store.session('A');
  const actions = createSwapActions(store, { makeKey: () => `key-${++key}`, processPhoto: async () => ({ files: pngs() }),
    upload: async () => `upload-${++key}`, gateway, objectURL: () => `blob:${++key}`, wait: async () => {},
    jobStarted: job => started.push(job) });
  return { store, actions, started };
}

test('an accepted swap is added to the job history and the progress bar shows it', async () => {
  const s = setup(async path => (path === '/generations' ? { job_id: 'swap-job', balance_after: 53 } : { job: null }));
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  assert.deepEqual(s.started, [{ job_id: 'swap-job', model_id: 'kling-o1-reference', credits: 47, templateId: 'test', name: 'Kling O1' }]);
  const now = Date.now();
  const rows = barRows([{ ...s.started[0], submitted_at: now - 60_000 }], now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job_id, 'swap-job');
  assert.equal(rows[0].label, 'Kling O1');
  assert.ok(rows[0].percent > 0 && rows[0].percent < 95);
});

test('a free-allowance swap records 0 credits, as Create does', async () => {
  const s = setup(async () => ({ job_id: 'free-job', free_allowance: true }));
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  assert.equal(s.started[0].credits, 0);
});

test('a refused or unknown submit adds nothing to the job history', async () => {
  for (const error of [{ code: 'insufficient_balance', status: 402 }, { code: 'price_changed', status: 409 },
    { code: 'provider_input_rejected', status: 422, body: { job_id: 'refused-job' } }, { code: 'network_error' }]) {
    const s = setup(async () => { throw error; });
    await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
    assert.deepEqual(s.started, [], error.code);
  }
  const failedUpload = setup(async () => ({ job_id: 'never' }));
  await failedUpload.actions.choose('test', new Blob(['raw']));
  const actions = createSwapActions(failedUpload.store, { makeKey: () => 'k', processPhoto: async () => ({ files: pngs() }),
    upload: async () => { throw { code: 'upload_failed' }; }, gateway: async () => ({ job_id: 'never' }), jobStarted: () => assert.fail('no job') });
  await actions.submit('test', offer);
  assert.equal(failedUpload.store.get('test')[0].state, 'upload_error');
});

test('an uncertain submit that the replay confirms is added once, after acceptance', async () => {
  let posts = 0;
  const s = setup(async path => {
    if (path === '/generations') { if (++posts === 1) throw { code: 'network_error' }; return { job_id: 'replayed-job' }; }
    if (path === '/balance') return { balance: 10 };
    return posts < 2 ? { job: null } : { job: { id: 'replayed-job', state: 'succeeded', refunded: false, refund_state: 'none' } };
  });
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  assert.deepEqual(s.started, []);
  await s.actions.reconcile('test', s.store.get('test')[0].key);
  assert.equal(s.started.length, 1);
  assert.equal(s.started[0].job_id, 'replayed-job');
  assert.equal(s.started[0].model_id, 'kling-o1-reference');
});

test('the swap model has its own expected duration, longer than the video default', () => {
  assert.equal(expectedDurationMs('kling-o1-reference'), 240_000);
  assert.ok(expectedDurationMs('kling-o1-reference') > expectedDurationMs('some-video-model'));
});

test('the web runtime writes accepted swaps to the job history; both swap screens show progress', () => {
  const runtime = readFileSync(new URL('../app/veyrnox/_lib/templateSwapRuntime.js', import.meta.url), 'utf8');
  assert.match(runtime, /jobStarted: \(\{ job_id, model_id, credits, name \}\) => pushJobHistory\(/);
  const web = readFileSync(new URL('../app/veyrnox/_components/SwapAttemptStatus.js', import.meta.url), 'utf8');
  assert.match(web, /<GeneratingProgress jobId=\{a\.job_id\} \/>/);
  const phone = readFileSync(new URL('../apps/mobile/src/components/templates/SwapAttemptStatus.tsx', import.meta.url), 'utf8');
  assert.match(phone, /<GenerationProgress key=\{a\.job_id\} jobId=\{a\.job_id\}/);
});
