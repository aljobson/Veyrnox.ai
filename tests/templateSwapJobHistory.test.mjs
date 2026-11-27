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
function setup(gateway, over = {}) {
  const started = []; let key = 0;
  const store = createSwapStore({ revoke: () => {} }); store.session('A');
  const actions = createSwapActions(store, { makeKey: () => `key-${++key}`, processPhoto: async () => ({ files: pngs() }),
    upload: async () => `upload-${++key}`, gateway, objectURL: () => `blob:${++key}`, wait: async () => {},
    jobStarted: job => started.push(job), ...over });
  return { store, actions, started };
}

test('an accepted swap is added to the job history and the progress bar shows it', async () => {
  const s = setup(async path => (path === '/generations' ? { job_id: 'swap-job', balance_after: 53 } : { job: null }));
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  assert.equal(s.started.length, 1);
  assert.deepEqual(s.started[0], { job_id: 'swap-job', model_id: 'kling-o1-reference', credits: 47, templateId: 'test', name: 'Kling O1', idempotent: undefined, recovering: false, submitted_at: s.store.get('test')[0].submitted_at });
  assert.ok(Number.isFinite(s.started[0].submitted_at));
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
    if (path === '/generations') { if (++posts === 1) throw { code: 'network_error' }; return { job_id: 'replayed-job', idempotent: true }; }
    if (path === '/balance') return { balance: 10 };
    return posts < 2 ? { job: null } : { job: { id: 'replayed-job', state: 'succeeded', refunded: false, refund_state: 'none' } };
  });
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  assert.deepEqual(s.started, []);
  await s.actions.reconcile('test', s.store.get('test')[0].key);
  assert.equal(s.started.length, 1);
  assert.equal(s.started[0].job_id, 'replayed-job');
  assert.equal(s.started[0].idempotent, true); assert.equal(s.started[0].recovering, true);
  assert.equal(s.started[0].model_id, 'kling-o1-reference');
});

test('the swap model has its own expected duration, longer than the video default', () => {
  assert.equal(expectedDurationMs('kling-o1-reference'), 240_000);
  assert.ok(expectedDurationMs('kling-o1-reference') > expectedDurationMs('some-video-model'));
});

test('the web runtime writes accepted swaps to the job history; both swap screens show progress', () => {
  const runtime = readFileSync(new URL('../app/veyrnox/_lib/templateSwapRuntime.js', import.meta.url), 'utf8');
  assert.match(runtime, /jobStarted: entry => pushJobHistory\(entry\)/);
  const web = readFileSync(new URL('../app/veyrnox/_components/SwapAttemptStatus.js', import.meta.url), 'utf8');
  assert.match(web, /<GeneratingProgress jobId=\{a\.job_id\} \/>/);
  const phone = readFileSync(new URL('../apps/mobile/src/components/templates/SwapAttemptStatus.tsx', import.meta.url), 'utf8');
  assert.match(phone, /<GenerationProgress key=\{a\.job_id\} jobId=\{a\.job_id\}/);
});

test('a running swap keeps being read past 12 lookups and settles instead of showing unresolved', async () => {
  const { POLL_LIMIT, LIVE_POLL_LIMIT } = await import('../app/veyrnox/_lib/templateSwapActions.mjs');
  let reads = 0; const waits = [], settlements = [];
  const s = setup(async path => {
    if (path === '/generations') return { job_id: 'slow-job' };
    if (path === '/balance') return { balance: 5 };
    reads++;
    return { job: { id: 'slow-job', state: reads < 20 ? 'running' : 'succeeded', refunded: false, refund_state: 'none' } };
  }, { jobSettled: (...args) => settlements.push(args) });
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  await s.actions.reconcile('test', s.store.get('test')[0].key);
  assert.ok(reads > POLL_LIMIT);
  assert.equal(reads, 20);
  assert.equal(s.store.get('test')[0].state, 'succeeded');
  assert.deepEqual(settlements, [['slow-job', 'running'], ['slow-job', 'succeeded']], 'unchanged running reads do not rebroadcast');
  assert.ok(LIVE_POLL_LIMIT * 20_000 >= 55 * 60_000, 'about an hour at the 20 s ceiling');
});

test('a job still running after the long window hands over to Check; an unknown outcome stays at 12 reads', async () => {
  const { POLL_LIMIT, LIVE_POLL_LIMIT } = await import('../app/veyrnox/_lib/templateSwapActions.mjs');
  let reads = 0;
  const s = setup(async path => (path === '/generations' ? { job_id: 'stuck-job' } : (reads++, { job: { id: 'stuck-job', state: 'running', refunded: false, refund_state: 'none' } })));
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  await s.actions.reconcile('test', s.store.get('test')[0].key);
  assert.equal(reads, LIVE_POLL_LIMIT);
  assert.equal(s.store.get('test')[0].state, 'unresolved');
  let unknownReads = 0;
  const u = setup(async path => { if (path === '/generations') throw { code: 'network_error' }; unknownReads++; return { job: { id: 'j', state: 'queued', refunded: false, refund_state: 'unknown' } }; });
  await u.actions.choose('test', new Blob(['raw'])); await u.actions.submit('test', offer);
  await u.actions.reconcile('test', u.store.get('test')[0].key);
  assert.equal(unknownReads, POLL_LIMIT);
  assert.equal(u.store.get('test')[0].state, 'unresolved');
});

test('lost response recovered by lookup registers the original submission and settles once', async () => {
  const s=setup(async path=>{
    if(path==='/generations')throw {code:'network_error'};
    if(path==='/balance')return {balance:10};
    return {job:{id:'recovered',state:'succeeded',refunded:false,refund_state:'none'}};
  });
  await s.actions.choose('test',new Blob(['raw']));await s.actions.submit('test',offer);
  const attempt=s.store.get('test')[0], settled=[];
  const actions=createSwapActions(s.store,{gateway:async path=>path==='/balance'?{balance:10}:{job:{id:'recovered',state:'succeeded',refunded:false,refund_state:'none'}},jobStarted:j=>s.started.push(j),jobSettled:(...args)=>settled.push(args),wait:async()=>{}});
  await actions.reconcile('test',attempt.key);
  assert.equal(s.started.length,1);assert.equal(s.started[0].submitted_at,attempt.submitted_at);
  assert.deepEqual(settled,[['recovered','succeeded']]);
  assert.ok(!JSON.stringify(s.store.get('test')).includes('asset_url'));
});

test('a first swap response forwards an old replay without claiming own recovery', async () => {
  const s = setup(async () => ({ job_id: 'old-job', idempotent: true }));
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  assert.equal(s.started[0].idempotent, true); assert.equal(s.started[0].recovering, false);
});
