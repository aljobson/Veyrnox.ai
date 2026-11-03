import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0438_kie_kling_route_costs.sql', 'utf8');
const price = readFileSync('packages/db/schema/supabase/0433_kie_kling_price_increase.sql', 'utf8');
const CAP = 0.01796; // ADR-0037

// Each cost is checked inside the UPDATE block of its own route, so swapping the two SET values fails.
const blocks = sql.split('DO $$').filter((b) => b.includes('UPDATE public.model_routes'));
const block26 = blocks.find((b) => b.includes("model_id = 'kling-2.6-pro-kie'"));
const block30 = blocks.find((b) => b.includes("model_id = 'kling-3.0-i2v-kie'"));

test('the kie route costs equal the catalog costs 0433 set, paired with the right route, inside the floor', () => {
  assert.match(price, /provider_cost_per_unit = 0\.3150, credits_5s = 18[\s\S]*?id = 'kling-2\.6-pro-kie'/);
  assert.match(price, /provider_cost_per_unit = 0\.5050, credits_5s = 29[\s\S]*?id = 'kling-3\.0-i2v-kie'/);
  assert.equal(blocks.length, 2);
  assert.ok(block26 && block30, 'one UPDATE block per offer');
  assert.match(block26, /SET cost_per_unit = 0\.3150/);
  assert.doesNotMatch(block26, /0\.5050/);
  assert.match(block30, /SET cost_per_unit = 0\.5050/);
  assert.doesNotMatch(block30, /0\.3150/);
  assert.ok(0.3150 <= 18 * CAP);
  assert.ok(0.5050 <= 29 * CAP);
});

test('the migration carries the KIE price-change cutoff in its approval guidance', () => {
  assert.match(sql, /2026-11-04 10:00 UTC/);
  assert.match(sql, /Approve the apply-migrations\s+-- run at or just after that time/);
});

test('each UPDATE names the kie route exactly, accepts the old or new cost, and asserts one row', () => {
  assert.match(sql, /model_id = 'kling-2\.6-pro-kie' AND supplier = 'kie' AND endpoint = 'market:kling-2\.6\/text-to-video'/);
  assert.match(sql, /model_id = 'kling-3\.0-i2v-kie' AND supplier = 'kie' AND endpoint = 'market:kling-3\.0\/video'/);
  assert.match(sql, /cost_per_unit IN \(0\.2750, 0\.3150\)/);
  assert.match(sql, /cost_per_unit IN \(0\.4500, 0\.5050\)/);
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2);
});

test('it changes nothing but those two costs: no state, priority, catalog, credit or reorder', () => {
  assert.equal((sql.match(/UPDATE public\.model_routes/g) || []).length, 2);
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i);
  assert.doesNotMatch(sql, /SET[^;]*\b(state|priority|provenance|credits_5s)\b/i);
  assert.doesNotMatch(sql, /model_route_reorder/);
});
