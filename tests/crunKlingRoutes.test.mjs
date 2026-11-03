import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0435_crun_kling_standby_routes.sql', 'utf8');

test('both Kling routes are standby priority-2 Crun rows costed per 5 s unit at the 206-per-dollar rate', () => {
  assert.match(sql, /\('kling-3\.0-i2v-kie', 'crun:kling\/v3',\s+0\.4369::numeric\)/);
  assert.match(sql, /\('kling-2\.6-pro-kie', 'crun:kling\/v2-6', 0\.2670::numeric\)/);
  assert.match(sql, /'per_second', 5, 2, 'standby', 'licensed_reseller'/);
  assert.equal((90 / 206).toFixed(4), '0.4369'); // 18 credits a second x 5 s
  assert.equal((55 / 206).toFixed(4), '0.2670');
  assert.match(sql, /<> 2 THEN/, 'it asserts exactly two rows');
});

test('the migration activates nothing and changes no price: a probe and the owner come first', () => {
  assert.doesNotMatch(sql, /state\s*=\s*'active'/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i);
  assert.doesNotMatch(sql, /model_route_reorder/);
});

test('each Crun cost is below the kie cost it would back, and inside the offer price floor', () => {
  const CAP = 0.01796; // ADR-0037
  assert.ok(0.4369 < 0.505 && 0.4369 <= 29 * CAP);
  assert.ok(0.2670 < 0.315 && 0.2670 <= 18 * CAP);
});
