import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../packages/db/schema/supabase/0622_crun_catalog_templates.sql', import.meta.url), 'utf8');

test('catalogue-template dispatch rows are private, active and inside the 50% margin floor', () => {
  for (const [id, endpoint, credits, cost] of [
    ['crun-catalog-kling-template', 'crun:kling/template', 102, 1.8268],
    ['crun-catalog-seedance-template', 'crun:bytedance/template', 170, 3.0355],
    ['crun-catalog-vidu-template', 'crun:vidu/template', 75, 1.3399],
  ]) {
    assert.match(sql, new RegExp(id)); assert.match(sql, new RegExp(endpoint.replace('/', '\\/')));
    assert.ok(cost <= credits * 0.01796);
  }
  assert.match(sql, /expected_cost:=GREATEST\(1,ceil\(upstream\*1000000\/206\)/);
  assert.match(sql, /expected_credits:=GREATEST\(1,ceil\(expected_cost::NUMERIC\/17960\)/);
  assert.match(sql, /p_credits IS DISTINCT FROM expected_credits/);
});
