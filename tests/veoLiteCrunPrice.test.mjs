import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0380_veo_lite_crun_price.sql', 'utf8');
const CAP = 0.01796; // ADR-0037: half of gross after the fee at the $129/3000 pack

test('4 credits is the smallest whole-credit price that keeps 50 percent at the Crun cost', () => {
  const cost = 0.067;
  assert.equal(Math.ceil(cost / CAP), 4);
  assert.ok(cost <= 4 * CAP);
  assert.ok(cost > 3 * CAP);
});

test('the update names the Crun row exactly, accepts the old or new price and asserts one row', () => {
  assert.match(sql, /provider = 'crun' AND provider_endpoint = 'crun:google\/veo3-1-lite-t2v'/);
  assert.match(sql, /provider_cost_per_unit = 0\.0670/);
  assert.match(sql, /credits_5s IN \(9, 4\)/);
  assert.match(sql, /IF affected <> 1 THEN/);
});

test('Crun is put first through the guarded reorder only where it is not already first', () => {
  assert.match(sql, /provider <> 'crun'/);
  assert.match(sql, /public\.model_route_reorder\(/);
  assert.match(sql, /RAISE EXCEPTION 'Could not put Crun first/);
});
