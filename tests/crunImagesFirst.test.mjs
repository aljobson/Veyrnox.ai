import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0389_crun_images_first.sql', 'utf8');
const CAP = 0.01796; // ADR-0037: half of gross after the fee at the $129/3000 pack

test('the cost is 3 Crun credits at the owner rate and 1 credit is its 50% floor', () => {
  const cost = 3 / 206;
  assert.equal(cost.toFixed(4), '0.0146');
  assert.equal(Math.ceil(cost / CAP), 1);
  assert.ok(cost <= CAP && cost > 0.5 * CAP);
});

test('the migration names both routes and the probes, records only what was verified, and asserts every step', () => {
  for (const id of ['nano-banana-kie', 'seedream-4']) assert.match(sql, new RegExp(`'${id}'`));
  assert.match(sql, /3b63f9cc-b179-40b0-8f27-ce236150facf/);
  assert.match(sql, /1f9ceec6-5b8c-4896-99bb-8fe4c02e7b4b/);
  assert.match(sql, /to be confirmed by the owner/, 'the charge is not claimed as read');
  assert.match(sql, /model identity vs kie not established/);
  assert.match(sql, /cost_per_unit = 0\.0146/);
  assert.match(sql, /credits_5s = 1/);
  assert.match(sql, /credits_5s IN \(2, 1\)/);
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2);
  assert.match(sql, /public\.model_route_reorder\(/);
  assert.match(sql, /provider <> 'crun'/);
});
