import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeOrder, generationCost } from '../lib/supplierRoutesPropose.js';

const offer = { id: 'veo-3.1-lite-kie', credits: 9, credits_5s: 9 };
const R = (id, supplier, priority, cost, extra = {}) => ({ id, supplier, priority, state: 'active', provenance: 'licensed_reseller', parity_record: 'p', cost_per_unit: cost, ...extra });
const all = () => true;

test('a cheaper dispatchable route moves first, with the saving per generation', () => {
  const kie = R('a', 'kie', 1, 0.15), crun = R('b', 'crun', 2, 0.067);
  const p = proposeOrder(offer, [kie, crun], { canDispatch: all });
  assert.deepEqual([p.changed, p.proposed, p.savingPerGeneration], [true, ['b', 'a'], 0.083]);
});

test('the same cost keeps today\'s order, and an order that is already cheapest proposes nothing', () => {
  assert.equal(proposeOrder(offer, [R('a', 'kie', 1, 0.1), R('b', 'fal', 2, 0.1)], { canDispatch: all }).changed, false);
  const p = proposeOrder(offer, [R('a', 'crun', 1, 0.067), R('b', 'kie', 2, 0.15)], { canDispatch: all });
  assert.deepEqual([p.changed, p.reason], [false, 'already the cheapest order']);
});

test('a route the Worker cannot dispatch is never first, however cheap', () => {
  const kie = R('a', 'kie', 1, 0.15), crun = R('b', 'crun', 2, 0.067);
  const p = proposeOrder(offer, [kie, crun], { canDispatch: (r) => r.supplier !== 'crun' });
  assert.equal(p.changed, false);
  const three = proposeOrder(offer, [R('a', 'kie', 1, 0.15), R('b', 'crun', 2, 0.01), R('c', 'fal', 3, 0.12)], { canDispatch: (r) => r.supplier !== 'crun' });
  assert.deepEqual(three.proposed, ['c', 'a', 'b']);
});

test('an unverified route is always last, even when it is cheapest', () => {
  const p = proposeOrder(offer, [R('a', 'kie', 1, 0.15), R('b', 'crun', 2, 0.067, { provenance: 'unverified' }), R('c', 'fal', 3, 0.12)], { canDispatch: all });
  assert.deepEqual(p.proposed, ['c', 'a', 'b']);
});

test('a lone route, an unproven route or a tripped breaker proposes nothing', () => {
  assert.equal(proposeOrder(offer, [R('a', 'kie', 1, 0.15)], { canDispatch: all }).changed, false);
  assert.match(proposeOrder(offer, [R('a', 'kie', 1, 0.15), R('b', 'fal', 2, 0.1, { breaker_opened_at: '2026-10-24' })], { canDispatch: all }).reason, /breaker/);
  assert.equal(proposeOrder(offer, [R('a', 'kie', 1, 0.15), R('b', 'fal', 2, 0.1, { state: 'standby' })], { canDispatch: all }).changed, false);
});

test('cost is per generation unit times the units the job is priced at', () => {
  assert.equal(generationCost({ cost_per_unit: 0.5 }, { credits: 9, credits_5s: 9 }), 0.5);
  assert.equal(generationCost({ cost_per_unit: 0.5 }, { credits: 18, credits_5s: 9 }), 1);
});

test('the script treats a registered supplier with a record as dispatchable, and Crun only when its flag is on in this shell', async () => {
  const { canDispatch } = await import('../scripts/propose-route-order.mjs');
  const crun = { supplier: 'crun', endpoint: 'crun:google/veo3-1-lite-t2v' };
  const keep = process.env.CRUN_ENABLED;
  try {
    assert.equal(canDispatch({ supplier: 'kie', endpoint: 'market:google/nano-banana' }), true);
    assert.equal(canDispatch({ supplier: 'kie', endpoint: 'market:not-a-model' }), false);
    delete process.env.CRUN_ENABLED;
    assert.equal(canDispatch(crun), false);
    process.env.CRUN_ENABLED = 'true';
    assert.equal(canDispatch(crun), true);
  } finally { if (keep === undefined) delete process.env.CRUN_ENABLED; else process.env.CRUN_ENABLED = keep; }
});
