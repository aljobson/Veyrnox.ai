import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0386_crun_veo_fast_first.sql', 'utf8');
const CAP = 0.01796; // ADR-0037: half of gross after the fee at the $129/3000 pack

test('the Veo Fast cost is 30 Crun credits at the owner top-up rate, and 9 credits is its 50% floor', () => {
  const cost = 30 / 206; // $50 bought 10,300 Crun credits
  assert.equal(cost.toFixed(4), '0.1456');
  assert.equal(Math.ceil(cost / CAP), 9);
  assert.ok(cost <= 9 * CAP);
  assert.ok(cost > 8 * CAP, '8 credits would break the floor');
});

test('the migration names the Crun Veo Fast route, records only what was verified, and asserts each step', () => {
  assert.match(sql, /crun:google\/veo3-1-fast-t2v/);
  assert.match(sql, /492debcb-36c1-4cf5-9a16-5c378364851c/);
  assert.match(sql, /clip fetched and viewed by Claude \(8\.0 s 1280x720 h264 \+ aac/, 'the record states what was actually checked');
  assert.match(sql, /model identity rests on Crun id/, 'and what a clip cannot prove');
  assert.match(sql, /cost_per_unit = 0\.1456/);
  assert.match(sql, /credits_5s = 9/);
  assert.match(sql, /credits_5s IN \(17, 9\)/);
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2);
  assert.match(sql, /public\.model_route_reorder\(/);
  assert.match(sql, /provider <> 'crun'/);
});
