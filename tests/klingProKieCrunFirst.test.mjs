import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0559_kling_3_pro_kie_crun_first.sql', 'utf8');

test('it proves and activates the Crun route, then reorders Crun first, on the kie offer only', () => {
  assert.match(sql, /endpoint = 'crun:kling\/v3' AND model_id = 'kling-3\.0-i2v-kie'/);
  assert.match(sql, /state = 'active'/);
  assert.match(sql, /model_route_reorder\(\s*'kling-3\.0-i2v-kie'/);
  assert.ok(sql.indexOf("state = 'active'") < sql.indexOf('model_route_reorder('), 'proof comes before the reorder');
  assert.doesNotMatch(sql, /model_id = 'kling-3\.0-i2v'[^-]/, 'the fal Pro offer is not touched');
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i, 'the catalog row is changed only by the guarded reorder');
});

test('the UPDATE names the row exactly and asserts one row; the end state asserts price and order', () => {
  assert.equal((sql.match(/GET DIAGNOSTICS affected = ROW_COUNT;/g) || []).length, 1);
  assert.match(sql, /IF affected <> 1 THEN/);
  assert.match(sql, /credits_5s = 29/);
  assert.match(sql, /<> 2 THEN/, 'final routes assertion');
});

test('the cost is 18 credits a second at 206 per dollar and both routes sit inside the 29-credit floor', () => {
  const CAP = 0.01796; // ADR-0037
  assert.equal(((18 * 5) / 206).toFixed(4), '0.4369');
  assert.match(sql, /cost_per_unit = 0\.4369/);
  assert.ok(0.4369 < 0.505, 'cheaper than kie');
  assert.ok(0.5050 <= 29 * CAP, 'kie, second, needs no margin waiver');
});

test('the parity record is honest about what was and was not established', () => {
  assert.match(sql, /290\*\*\*df4/);
  assert.match(sql, /180 credits/);
  assert.match(sql, /not inspected \(clip not downloaded\)/);
  assert.match(sql, /one sample/);
});

test('the DB acceptance script expects crun:kling/v3 among the active Crun routes', () => {
  const failover = readFileSync('scripts/test-supplier-route-failover.mjs', 'utf8');
  assert.match(failover, /'crun:kling\/v2-6', 'crun:kling\/v3', 'crun:kling\/v3-std'/);
});
