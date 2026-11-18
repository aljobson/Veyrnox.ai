import test from 'node:test';
import assert from 'node:assert/strict';
import { faceBoxFromResult, swapRequest, reduceAttempt, lookupJobByKey, fetchSwapAvailability } from '../app/veyrnox/_lib/templateSwapClient.mjs';
import { createSwapStore } from '../app/veyrnox/_lib/templateSwapStore.mjs';
import { JOB_STATES, publicJobState } from '../lib/jobState.js';
const offer = { id: 'test', model: 'kling-o1-reference', credits: 47, images: 2, durationSeconds: 5, role: 'the lead' };
const refs = ['front', 'crop'].map(key => ({ slot: 'image', origin: 'upload', key }));
const attempt = () => ({ accountId: 'A', templateId: 'test', key: 'original', body: swapRequest(offer, 'original', refs), references: refs, state: 'submitting' });
const failure = (code, status = 400, job_id) => ({ name: 'GatewayError', code, status, body: { job_id } });
test('availability accepts only a valid 200; failures stay dark', async () => {
  for (const status of [200, 201, 404, 500]) assert.deepEqual(await fetchSwapAvailability('test', async url => {
    assert.equal(url, '/api/catalog?template_swap=test'); return { status, json: async () => offer };
  }), status === 200 ? offer : null);
  assert.equal(await fetchSwapAvailability('test', async () => { throw Error(); }), null);
});
test('request contains exactly the swap contract and ordered pair', () => {
  assert.deepEqual(swapRequest(offer, 'key', refs), { template_swap: 'test', model_id: offer.model, idempotency_key: 'key', inputs: {}, max_charge_credits: 47, references: refs, consent: true });
  assert.throws(() => swapRequest(offer, 'key', refs.slice(1)));
});
test('face adapter uses real count/478 landmarks protocol', () => {
  const size = { width: 1000, height: 800 };
  assert.equal(faceBoxFromResult({ count: 0, landmarks: new Float32Array() }, size).error, 'no_face');
  assert.equal(faceBoxFromResult({ count: 2, landmarks: new Float32Array() }, size).error, 'several_people');
  const landmarks = Float32Array.from({ length: 478 * 3 }, (_, i) => i % 3 === 2 ? 0 : i % 2 ? .6 : .3);
  assert.equal(faceBoxFromResult({ count: 1, landmarks }, size).ok, true);
  assert.equal(faceBoxFromResult({ count: 1, landmarks: landmarks.slice(3) }, size).error, 'invalid_face');
  landmarks[0] = NaN;
  assert.equal(faceBoxFromResult({ count: 1, landmarks }, size).error, 'invalid_face');
});
test('financial claims follow history: lost reply then disabled gate remains unknown', () => {
  let a = reduceAttempt(attempt(), { error: failure('network_error', 0) });
  a = reduceAttempt(a, { error: failure('template_swap_not_found', 404) });
  assert.equal(a.state, 'unknown'); assert.equal(a.key, 'original'); assert.deepEqual(a.references, refs);
  a = reduceAttempt(a, { job: { id: 'job', state: 'failed', refunded: false, refund_state: 'pending' } });
  assert.equal(a.state, 'refund_pending');
  a = reduceAttempt(a, { job: { id: 'job', state: 'failed', refunded: true, refund_state: 'confirmed' } });
  assert.equal(a.state, 'refunded');
  assert.equal(reduceAttempt(attempt(), { error: failure('consent_required') }).state, 'not_charged');
});
test('post-debit handle survives queued/unknown lookup', () => {
  let a = reduceAttempt(attempt(), { error: failure('provider_input_rejected', 422, 'job') });
  assert.equal(a.state, 'refund_pending');
  a = reduceAttempt(a, { job: { id: 'job', state: 'queued', refunded: false, refund_state: 'unknown' } });
  assert.equal(a.state, 'refund_pending'); assert.equal(a.job_id, 'job'); assert.equal(a.errorCode, 'provider_input_rejected');
});
test('lookup accepts B1 public state mapping and null, never invents a refund', async () => {
  for (const state of new Set(JOB_STATES.map(publicJobState))) {
    const job = { id: 'job', state, refunded: false, refund_state: 'unknown' };
    assert.deepEqual(await lookupJobByKey('key', async path => { assert.equal(path, '/jobs?idempotency_key=key'); return { job }; }), job);
  }
  assert.equal(await lookupJobByKey('key', async () => ({ job: null })), null);
});
test('store isolates accounts, suspends expiry, purges signout and ignores stale completions', () => {
  const revoked = []; const store = createSwapStore({ revoke: url => revoked.push(url) });
  store.session('A'); store.put({ ...attempt(), files: [new Blob(['front']), new Blob(['crop'])], urls: ['front-url', 'crop-url'] });
  const controller = store.controller('original');
  store.session(null, 'expired'); assert.equal(controller.signal.aborted, true); assert.deepEqual(store.get('test'), []);
  store.session('A'); assert.equal(store.get('test')[0].files.length, 2);
  const ticket = store.ticket('original'); store.session('B');
  assert.equal(store.update(ticket, { state: 'refunded' }), false); assert.deepEqual(store.get('test'), []);
  assert.deepEqual(revoked, ['front-url', 'crop-url']);
  store.put({ ...attempt(), accountId: 'B' });
  store.session('A'); assert.equal(store.get('test')[0].key, 'original'); assert.equal(store.get('test')[0].files, undefined);
  store.session(null, 'signout'); store.session('A'); assert.deepEqual(store.get('test'), []);
});
test('shared template submit supports swap only and refuses conflicting modes before uploading', async () => {
  const { submitTemplate } = await import('../app/veyrnox/_lib/templateGenerate.js');
  const { createBatch } = await import('../app/veyrnox/_lib/imageBatch.js');
  let body, uploads = 0;
  const args={run:createBatch(1,()=> 'same-key'),quote:{ceilings:[47]},model:{id:offer.model},preset:{id:offer.id},inputs:{},templateSwap:offer,
    deps:{sources:async()=>{uploads++;return {references:refs};},gatewayFetch:async(_,init)=>{body=JSON.parse(init.body);return {job_id:'job'};},onJob(){}}};
  assert.equal((await submitTemplate({...args,templateClip:offer})).error.code,'template_source_conflict');assert.equal(uploads,0);
  assert.equal((await submitTemplate(args)).error,null);assert.deepEqual(body,swapRequest(offer,'same-key',refs));
});
test('swap errors resolve to field guidance without vendor messages', async () => {
  const { swapErrorKey } = await import('../app/veyrnox/_lib/templateSwapClient.mjs');
  for(const code of ['template_swap_image_size','template_swap_photo_count','template_swap_not_found','consent_required','busy_background','ragged_matte','no_face','several_people','face_too_small']) assert.match(swapErrorKey(code),/^presets.swap\./);
  assert.equal(swapErrorKey('provider stack details'),'presets.swap.cutout_failed');
});
