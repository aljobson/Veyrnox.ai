import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shadowEnabled, compareShadow, logShadowRoute } from '../lib/supplierRoutesShadow.js';

const offer = { id: 'veo-3.1-lite-kie', provider: 'kie', provider_endpoint: 'veo:veo3_lite' };
const own = { id: 'r1', supplier: 'kie', endpoint: 'veo:veo3_lite', priority: 1, state: 'active', provenance: 'licensed_reseller', parity_record: 'current dispatch (0367 backfill)', cost_per_unit: 0.15, cost_unit: 'per_generation' };
const crun = { id: 'r2', supplier: 'crun', endpoint: 'crun:google/veo3-1-lite-t2v', priority: 2, state: 'standby', provenance: 'unverified', parity_record: null, cost_per_unit: 0.067, cost_unit: 'per_generation' };

test('shadow is off unless the flag is exactly "true"', () => {
  assert.equal(shadowEnabled({}), false);
  assert.equal(shadowEnabled({ SUPPLIER_ROUTES_SHADOW: 'false' }), false);
  assert.equal(shadowEnabled({ SUPPLIER_ROUTES_SHADOW: 'yes' }), false);
  assert.equal(shadowEnabled({ SUPPLIER_ROUTES_SHADOW: 'TRUE' }), true);
});

test('off: no table read and no log', async () => {
  let reads = 0; const logs = [];
  const r = await logShadowRoute(offer, {}, { env: {}, read: async () => { reads += 1; return []; }, log: (...a) => logs.push(a) });
  assert.equal(r, null); assert.equal(reads, 0); assert.deepEqual(logs, []);
});

test('on: the offer\'s own route matches, and a standby Crun route never wins', async () => {
  const logs = [];
  const r = await logShadowRoute(offer, {}, { env: { SUPPLIER_ROUTES_SHADOW: 'true' }, read: async () => [crun, own], log: (...a) => logs.push(a) });
  assert.deepEqual(r, { match: true, chosen: 'kie', reason: 'same_route' });
  assert.match(logs[0][0], /shadow/);
  assert.deepEqual(JSON.parse(logs[0][1]), { model: 'veo-3.1-lite-kie', dispatch: 'kie', match: true, chosen: 'kie', reason: 'same_route' });
});

test('a different first route is reported as a mismatch, no routes as no_routes', () => {
  assert.deepEqual(compareShadow(offer, [{ ...own, supplier: 'fal' }]), { match: false, chosen: 'fal', reason: 'different_route' });
  assert.deepEqual(compareShadow(offer, []), { match: false, chosen: null, reason: 'no_routes' });
  assert.deepEqual(compareShadow(offer, [crun]), { match: false, chosen: null, reason: 'no_eligible_route' });
});

test('a failing read is swallowed into one log line', async () => {
  const logs = [];
  const r = await logShadowRoute(offer, {}, { env: { SUPPLIER_ROUTES_SHADOW: 'true' }, read: async () => { throw new Error('relation "model_routes" does not exist'); }, log: (...a) => logs.push(a) });
  assert.equal(r, null);
  assert.match(logs[0][0], /shadow failed/);
});

test('the generation route calls it without awaiting, after the provider is resolved', () => {
  const src = readFileSync(new URL('../app/api/v1/generations/route.js', import.meta.url), 'utf8');
  assert.match(src, /const shadowDone = logShadowRoute\(modelRow, cfg\);/);
  assert.match(src, /keepAlive\(shadowDone\)/);
  assert.ok(src.indexOf('providerFor(modelRow.provider)') < src.indexOf('const shadowDone'));
  assert.doesNotMatch(src, /await logShadowRoute/);
});
