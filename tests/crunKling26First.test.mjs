import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0436_crun_kling_26_first.sql', 'utf8');
const CAP = 0.01796; // ADR-0037

test('the Kling 2.6 cost is 55 Crun credits at the owner top-up rate, and 18 credits stays above its floor', () => {
  const cost = 55 / 206;
  assert.equal(cost.toFixed(4), '0.2670');
  assert.ok(cost <= 18 * CAP);
  assert.ok(0.3150 <= 18 * CAP, 'kie, now second, stays inside the floor so a hop needs no waiver');
});

test('the migration names the Crun 2.6 route and the probe, and states what was not established', () => {
  assert.match(sql, /crun:kling\/v2-6/);
  assert.match(sql, /3d31954f-b9de-4181-b33a-c32a8ec17a36/);
  assert.match(sql, /static\.mediaoss\.bar/);
  assert.match(sql, /charge 55 credits expected, to be confirmed in Crun log/);
  assert.match(sql, /model identity rests on Crun id/);
  assert.match(sql, /cost_per_unit = 0\.2670/);
});

test('it activates one route, reorders through the guarded function, and changes no price', () => {
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2, 'route activation and the final state check');
  assert.match(sql, /public\.model_route_reorder\(/);
  assert.match(sql, /provider <> 'crun'/);
  assert.match(sql, /credits_5s = 18/);
  assert.doesNotMatch(sql, /SET credits_5s/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i);
});
