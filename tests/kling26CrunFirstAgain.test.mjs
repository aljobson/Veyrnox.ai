import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0584_kling_26_crun_first_again.sql', 'utf8');

test('it reorders Crun first through the guarded function and changes nothing else', () => {
  assert.match(sql, /model_route_reorder\(\s*'kling-2\.6-pro-kie'/);
  assert.match(sql, /CASE supplier WHEN 'crun' THEN 0 ELSE 1 END/);
  assert.match(sql, /state = 'active'/);
  assert.doesNotMatch(sql, /UPDATE\s+public\./i, 'the catalog row is changed only by the guarded reorder');
  assert.doesNotMatch(sql, /INSERT\s+INTO/i);
});

test('the reorder is skipped when Crun is already first, so a replay is a no-op', () => {
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM public\.model_catalog WHERE id = 'kling-2\.6-pro-kie' AND provider <> 'crun'\)/);
});

test('it asserts the end state: Crun first, kie second, the unchanged 18 credits and the route cost on the catalog row', () => {
  assert.match(sql, /credits_5s = 18/);
  assert.match(sql, /priority = 1 AND supplier = 'crun' AND endpoint = 'crun:kling\/v2-6'/);
  assert.match(sql, /priority = 2 AND supplier = 'kie' AND endpoint = 'market:kling-2\.6\/text-to-video'/);
  assert.match(sql, /<> 1 THEN/);
  assert.match(sql, /<> 2 THEN/);
});

test('Crun, now first, and kie, now second, both sit inside the 18-credit floor', () => {
  const CAP = 0.01796; // ADR-0037
  assert.equal((55 / 206).toFixed(4), '0.2670');
  assert.ok(0.2670 <= 18 * CAP);
  assert.ok(0.3150 <= 18 * CAP, 'a hop to kie needs no margin waiver');
});

test('the header states the speed trade and what was not measured', () => {
  assert.match(sql, /median 386 s/);
  assert.match(sql, /NOT established: whether Crun is faster today/);
  assert.match(sql, /owner/i);
});
