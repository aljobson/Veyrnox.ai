import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseRoute, routeFloor, shadowMatches, COST_CAP_PER_CREDIT } from '../lib/supplierRoutes.js';
import { creditsForFloor } from '../scripts/lib/fal-price-check.mjs';

const route = (o) => ({ id: o.supplier, state: 'active', parity_record: 'p', provenance: 'official', cost_unit: 'per_generation', cost_per_unit: 0.1, ...o });
const migration = readFileSync(new URL('../packages/db/schema/supabase/0367_supplier_routes_tables.sql', import.meta.url), 'utf8');

test('the cost cap is the same one the catalog trigger uses', () => {
  assert.equal(COST_CAP_PER_CREDIT, 0.01796);
  assert.equal(creditsForFloor(0.45), 26);
});

test('routes are ordered by priority, at most three, and need a parity record', () => {
  const routes = [
    route({ supplier: 'fal', priority: 2 }), route({ supplier: 'kie', priority: 1 }),
    route({ supplier: 'grsai', priority: 3 }), route({ supplier: 'byteplus', priority: 3, id: 'x' }),
    route({ supplier: 'openrouter', priority: 1, id: 'np', parity_record: null }),
  ];
  assert.deepEqual(chooseRoute(routes).map((r) => r.supplier), ['kie', 'fal', 'grsai']);
});

test('a standby route, an open breaker and an unverified route are skipped unless allowed', () => {
  const routes = [
    route({ supplier: 'kie', priority: 1 }),
    route({ supplier: 'fal', priority: 2, state: 'standby' }),
    route({ supplier: 'grsai', priority: 3, provenance: 'unverified' }),
  ];
  assert.deepEqual(chooseRoute(routes, { health: { kie: { open: true } } }), []);
  assert.deepEqual(chooseRoute(routes).map((r) => r.supplier), ['kie']);
  assert.deepEqual(chooseRoute(routes, { allowUnverified: true }).map((r) => r.supplier), ['kie', 'grsai']);
});

test('an unverified route is last even when it is the cheapest priority', () => {
  const routes = [route({ supplier: 'grsai', priority: 1, provenance: 'unverified' }), route({ supplier: 'kie', priority: 2 })];
  assert.deepEqual(chooseRoute(routes, { allowUnverified: true }).map((r) => r.supplier), ['kie', 'grsai']);
});

test('the floor holds for the dearest active route, unless it carries a waiver', () => {
  const fal = route({ supplier: 'fal', cost_per_unit: 0.56 });
  const kie = route({ supplier: 'kie', cost_per_unit: 0.45 });
  assert.equal(routeFloor(32, [fal, kie]).ok, true);
  const tight = routeFloor(26, [fal, kie]);
  assert.equal(tight.ok, false);
  assert.deepEqual(tight.breaches, ['fal']);
  assert.equal(routeFloor(26, [{ ...fal, margin_waiver_note: 'resilience only' }, kie]).ok, true);
  assert.equal(routeFloor(26, [{ ...fal, state: 'standby' }, kie]).ok, true);
});

test('shadow mode agrees with dispatch when the first route is the offer\'s own', () => {
  const offer = { provider: 'kie', provider_endpoint: 'market:kling-3.0/video' };
  const own = route({ supplier: 'kie', endpoint: 'market:kling-3.0/video', priority: 1 });
  assert.equal(shadowMatches(offer, [own]), true);
  assert.equal(shadowMatches(offer, [route({ supplier: 'fal', endpoint: 'x', priority: 1 }), own]), false);
});

test('the migration is service-role only and backfills one active route, mirroring the catalog', () => {
  assert.match(migration, /ALTER TABLE public\.model_routes FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE public\.job_attempts FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.model_routes FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON public\.model_routes TO service_role/);
  assert.match(migration, /ON CONFLICT \(model_id, priority\) DO NOTHING/);
  assert.match(migration, /c\.modality <> 'text'/);
  assert.doesNotMatch(migration, /UPDATE public\.model_catalog|DELETE FROM|TRUNCATE/);
});

test('a tripped route is skipped during the ten-minute cooldown and is a probe after it', async () => {
  const { breakerOpen, BREAKER_COOLDOWN_MS } = await import('../lib/supplierRoutes.js');
  const now = Date.parse('2026-10-24T15:00:00Z');
  const tripped = (minutesAgo) => route({ supplier: 'kie', priority: 1, breaker_opened_at: new Date(now - minutesAgo * 60000).toISOString() });
  assert.equal(BREAKER_COOLDOWN_MS, 600000);
  assert.equal(breakerOpen(tripped(2), now), true);
  assert.equal(breakerOpen(tripped(11), now), false);
  assert.equal(breakerOpen(route({ supplier: 'kie' }), now), false);
  assert.deepEqual(chooseRoute([tripped(2), route({ supplier: 'fal', priority: 2 })], { now }).map((r) => r.supplier), ['fal']);
  assert.deepEqual(chooseRoute([tripped(11), route({ supplier: 'fal', priority: 2 })], { now }).map((r) => r.supplier), ['kie', 'fal']);
});
