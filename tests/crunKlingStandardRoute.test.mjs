import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0557_crun_kling_standard_standby_route.sql', 'utf8');

test('the Standard route is one standby priority-2 Crun row, costed per 5 s at 14 credits a second and 206 per dollar', () => {
  assert.match(sql, /\('kling-3\.0-standard-i2v', 'crun:kling\/v3-std', 0\.3398::numeric\)/);
  assert.match(sql, /'per_second', 5, 2, 'standby', 'licensed_reseller'/);
  assert.equal(((14 * 5) / 206).toFixed(4), '0.3398');
  assert.match(sql, /<> 1 THEN/, 'it asserts exactly one row');
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM public\.model_routes r/, 'a replay must not insert once an offer has three routes');
});

test('it activates nothing, reorders nothing and changes no price', () => {
  assert.doesNotMatch(sql, /state\s*=\s*'active'/);
  assert.doesNotMatch(sql, /UPDATE\s+public\./i);
  assert.doesNotMatch(sql, /model_route_reorder/);
});

test('the Crun cost is below fal Standard and inside the offer price floor', () => {
  const CAP = 0.01796; // ADR-0037
  assert.ok(0.3398 < 0.42, 'fal Standard is $0.084 a second, $0.42 per 5 s');
  assert.ok(0.3398 <= 24 * CAP, 'the offer sells 24 credits per 5 s (0556)');
});
