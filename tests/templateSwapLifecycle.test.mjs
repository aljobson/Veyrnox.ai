import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwapStore } from '../app/veyrnox/_lib/templateSwapStore.mjs';
import { createSwapActions, POLL_LIMIT, pollDelay } from '../app/veyrnox/_lib/templateSwapActions.mjs';
import { fetchSwapAvailability } from '../app/veyrnox/_lib/templateSwapClient.mjs';
const offer = { id: 'test', model: 'kling-o1-reference', credits: 47 };
const pngs = () => [new Blob(['front'], { type: 'image/png' }), new Blob(['crop'], { type: 'image/png' })];
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve }; };
function setup(over = {}) {
  const revoked = [], uploads = [], requests = [], waits = []; let key = 0, processes = 0;
  const store = createSwapStore({ revoke: u => revoked.push(u) }); store.session('A');
  const actions = createSwapActions(store, { makeKey: () => `key-${++key}`, processPhoto: async () => { processes++; return { files: pngs() }; },
    upload: async f => { uploads.push(await f.text()); return 'upload-' + uploads.length; },
    gateway: async (path, init) => { requests.push([path, init]); return { job_id: 'job' }; },
    objectURL: () => `blob:${++key}`, wait: async ms => { waits.push(ms); }, ...over });
  return { store, actions, revoked, uploads, requests, waits, processes: () => processes };
}
test('blocked cutout never uploads the original; provider retry reuploads same PNG bytes without processing', async () => {
  const blocked = setup({ processPhoto: async () => { throw Error('no_face'); } });
  await blocked.actions.choose('test', new Blob(['raw'])); await blocked.actions.submit('test', offer);
  assert.deepEqual(blocked.uploads, []); assert.deepEqual(blocked.requests, []);
  let calls = 0;
  const s = setup({ gateway: async () => { if (++calls === 1) throw { code: 'provider_input_rejected', status: 422, body: { job_id: 'refusing-job' } }; return { job_id: 'new-job', balance_after: 77 }; } });
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  const previous = s.store.get('test')[0];
  await s.actions.submit('test', offer);
  assert.deepEqual(s.uploads, ['front','crop','front','crop']); assert.equal(s.processes(), 1);
  assert.equal(s.store.get('test')[0].job_id, 'refusing-job'); assert.notEqual(s.store.get('test')[1].key, previous.key);
});
test('lost response and focus 404 retain attempt; independent lookup settles pending then confirmed', async () => {
  let reads = 0;
  const s = setup({ gateway: async path => {
    if (path === '/generations') throw { code: 'network_error' };
    return { job: { id: 'job', state: 'failed', refunded: ++reads > 1, refund_state: reads > 1 ? 'confirmed' : 'pending' } };
  } });
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  const a = s.store.get('test')[0];
  assert.equal(await fetchSwapAvailability('test', async () => ({ status: 404 })), null);
  assert.equal(s.store.get('test')[0].state, 'unknown');
  await s.actions.reconcile('test', a.key);
  const settled = s.store.get('test')[0];
  assert.equal(settled.state, 'refunded'); assert.equal(settled.key, a.key); assert.deepEqual(settled.references, a.references);
});
test('polling bounded at 12 reads, 2s to 20s; no-charge and refund never inferred from failed/null lookups', async () => {
  let reads = 0; const s = setup({ gateway: async path => { if (path === '/generations') throw { code: 'network_error' }; reads++; return { job: null }; } });
  await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
  await s.actions.reconcile('test', s.store.get('test')[0].key);
  assert.equal(reads, POLL_LIMIT); assert.equal(s.waits.length, 11); assert.deepEqual(s.waits, Array.from({length:11},(_,i)=>pollDelay(i)));
  assert.equal(s.waits[0], 2000); assert.equal(s.waits.at(-1), 20000); assert.equal(s.store.get('test')[0].state, 'unresolved');
});
test('upload expiry keeps byte-identical PNGs for same account; different account purges URLs and blocks completions', async () => {
  let calls = 0, store; const sent = [];
  const s = setup({ upload: async (file, { signal }) => { sent.push(await file.text()); if (++calls === 1) { store.session(null, 'expired'); assert.equal(signal.aborted, true); throw { code: 'unauthenticated' }; } return `upload-${calls}`; } });
  store = s.store;
  await s.actions.choose('test', new Blob(['raw'])); const files = store.get('test')[0].files;
  await s.actions.submit('test', offer); assert.equal(s.requests.length, 0); assert.deepEqual(store.get('test'), []);
  store.session('A'); assert.deepEqual(store.get('test')[0].files, files);
  await s.actions.submit('test', offer); assert.deepEqual(sent, ['front', 'front', 'crop']); assert.equal(s.processes(), 1);
  const late = deferred(); const other = setup({ upload: () => late.promise });
  await other.actions.choose('test', new Blob(['raw'])); const pending = other.actions.submit('test', offer);
  other.store.session(null, 'expired'); other.store.session('B'); late.resolve('old-upload'); await pending;
  assert.equal(other.revoked.length, 2); assert.deepEqual(other.store.get('test'), []); assert.deepEqual(other.requests, []);
});
test('account switch discards a late lookup and explicit/default clears purge; store never accesses Storage', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { assert.fail('web storage accessed'); } });
  try {
    const late = deferred(); const s = setup({ gateway: async path => path === '/generations' ? Promise.reject({code:'network_error'}) : late.promise });
    await s.actions.choose('test', new Blob(['raw'])); await s.actions.submit('test', offer);
    const a = s.store.get('test')[0], pending = s.actions.reconcile('test', a.key);
    s.store.session('B'); late.resolve({ job: { id: 'job', state:'failed', refunded:true, refund_state:'confirmed' } }); await pending;
    assert.deepEqual(s.store.get('test'), []); assert.equal(s.waits.length, 0);
    s.store.session('A'); assert.equal(s.store.get('test')[0].state, 'unknown'); assert.deepEqual(s.store.get('test')[0].references, a.references);
    s.store.session(null); s.store.session('A'); assert.deepEqual(s.store.get('test'), []);
    await s.actions.choose('test', new Blob(['raw'])); s.store.session(null, 'signout'); s.store.session('A'); assert.deepEqual(s.store.get('test'), []);
  } finally { if (descriptor) Object.defineProperty(globalThis,'localStorage',descriptor); else delete globalThis.localStorage; }
});
test('unknown replay keeps exact body/key/references when gate turns off, until lookup confirms refund', async () => {
  const bodies=[]; let stage='unknown';
  const s=setup({gateway:async(path,init)=>{
    if(path==='/generations'){bodies.push(init.body);throw {code:bodies.length===1?'network_error':'template_swap_not_found',status:404};}
    if(path==='/balance')return {balance:91};
    return {job:stage==='unknown'?null:{id:'job',state:'failed',refunded:true,refund_state:'confirmed'}};
  }});
  await s.actions.choose('test',new Blob(['raw']));await s.actions.submit('test',offer);
  const before=s.store.get('test')[0];await s.actions.reconcile('test',before.key);
  assert.equal(s.store.get('test')[0].state,'unresolved');assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
  assert.equal(s.uploads.length,2);assert.deepEqual(s.store.get('test')[0].references,before.references);
  stage='confirmed';await s.actions.reconcile('test',before.key);
  assert.equal(s.store.get('test')[0].state,'refunded');assert.equal(s.store.get('test')[0].balance,91);
});

test('an uncertain attempt moves to running only when the lookup finds a running job, never from queued', async () => {
  const { reduceAttempt } = await import('../app/veyrnox/_lib/templateSwapClient.mjs');
  const base = { key: 'k', uncertain: true, state: 'unknown' };
  const running = reduceAttempt(base, { job: { id: 'j', state: 'running', refunded: false, refund_state: 'unknown' } });
  assert.equal(running.state, 'running');
  assert.equal(running.uncertain, false);
  // A refused submit whose refund failed also reads as queued, so queued must stay unresolved.
  const queued = reduceAttempt(base, { job: { id: 'j', state: 'queued', refunded: false, refund_state: 'unknown' } });
  assert.equal(queued.state, 'unknown');
  assert.equal(queued.uncertain, true);
});

test('the availability request carries its own deadline and still honours the caller abort', async () => {
  let received;
  const fetcher = async (_url, { signal }) => { received = signal; throw new Error('network'); };
  const caller = new AbortController();
  assert.equal(await fetchSwapAvailability('t', fetcher, caller.signal), null);
  assert.ok(received instanceof AbortSignal);
  assert.notEqual(received, caller.signal);
  const again = new AbortController();
  let seen;
  await fetchSwapAvailability('t', async (_u, { signal }) => { seen = signal; return { status: 404 }; }, again.signal);
  again.abort();
  assert.equal(seen.aborted, true);
});
