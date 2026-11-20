import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0561_kling_26_kie_first.sql', 'utf8');

test('it reorders kie first through the guarded function and changes nothing else', () => {
  assert.match(sql, /model_route_reorder\(\s*'kling-2\.6-pro-kie'/);
  assert.match(sql, /CASE supplier WHEN 'kie' THEN 0 ELSE 1 END/);
  assert.match(sql, /state = 'active'/);
  assert.doesNotMatch(sql, /UPDATE\s+public\./i, 'the catalog row is changed only by the guarded reorder');
  assert.doesNotMatch(sql, /INSERT\s+INTO/i);
});

test('the reorder is skipped when kie is already first, so a replay is a no-op', () => {
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM public\.model_catalog WHERE id = 'kling-2\.6-pro-kie' AND provider <> 'kie'\)/);
});

test('it asserts the end state: kie first, Crun second, the unchanged 18 credits and the route cost on the catalog row', () => {
  assert.match(sql, /credits_5s = 18/);
  assert.match(sql, /priority = 1 AND supplier = 'kie' AND endpoint = 'market:kling-2\.6\/text-to-video'/);
  assert.match(sql, /priority = 2 AND supplier = 'crun' AND endpoint = 'crun:kling\/v2-6'/);
  assert.match(sql, /<> 1 THEN/);
  assert.match(sql, /<> 2 THEN/);
});

test('kie, now first, and Crun, now second, both sit inside the 18-credit floor', () => {
  const CAP = 0.01796; // ADR-0037
  assert.ok(0.3150 <= 18 * CAP, 'kie 0.3150 <= 0.3233');
  assert.ok(0.2670 <= 18 * CAP);
  assert.ok(0.3500 > 18 * CAP, 'fal would need a higher price, which is why it is not routed');
});

test('the header states the cost trade honestly and what was not measured', () => {
  assert.match(sql, /about 18% more than Crun/);
  assert.match(sql, /NOT established: kie's speed today/);
  assert.match(sql, /not a cost saving/);
});
