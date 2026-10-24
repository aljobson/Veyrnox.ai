import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0380_veo_lite_crun_price.sql', 'utf8');
const CAP = 0.01796; // ADR-0037: half of gross after the fee at the $129/3000 pack

test('5 credits is the smallest whole-credit price that keeps 50 percent at the Crun cost', () => {
  const cost = 15 / 206; // 15 Crun credits at the owner's $50 top-up, 206 per $1
  assert.equal(cost.toFixed(4), '0.0728');
  assert.equal(Math.ceil(cost / CAP), 5);
  assert.ok(cost <= 5 * CAP);
  assert.ok(cost > 4 * CAP);
});

test('the update names the Crun row exactly, accepts the old or new price and asserts one row', () => {
  assert.match(sql, /provider = 'crun' AND provider_endpoint = 'crun:google\/veo3-1-lite-t2v'/);
  assert.match(sql, /provider_cost_per_unit IN \(0\.0670, 0\.0728\)/);
  assert.match(sql, /credits_5s IN \(9, 5\)/);
  assert.match(sql, /cost_per_unit = 0\.0728/);
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2);
});

test('Crun is put first through the guarded reorder only where it is not already first', () => {
  assert.match(sql, /provider <> 'crun'/);
  assert.match(sql, /public\.model_route_reorder\(/);
  assert.match(sql, /RAISE EXCEPTION 'Could not put Crun first/);
});
