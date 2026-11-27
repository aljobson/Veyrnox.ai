import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0626_openrouter_seedance_fast_route_cost.sql', 'utf8');
const watcher = readFileSync('scripts/check-openrouter-route-prices.mjs', 'utf8');
const CAP = 0.01796;

test('the watcher and route migration record the same public OpenRouter price', () => {
  const observed = 108_000 * 0.0000056;
  assert.equal(observed, 0.6048);
  assert.match(watcher, /'seedance-2\.0-fast': 0\.6048/);
  assert.match(sql, /SET cost_per_unit = 0\.6048/);
});

test('the migration updates only the exact secondary route and is replay safe', () => {
  assert.match(sql, /model_id = 'seedance-2\.0-fast'/);
  assert.match(sql, /supplier = 'openrouter'/);
  assert.match(sql, /endpoint = 'bytedance\/seedance-2\.0-fast'/);
  assert.match(sql, /cost_unit = 'per_generation'/);
  assert.match(sql, /billing_seconds IS NULL/);
  assert.match(sql, /priority = 2/);
  assert.match(sql, /state = 'active'/);
  assert.match(sql, /parity_record IS NOT NULL/);
  assert.match(sql, /margin_waiver_note IS NULL/);
  assert.match(sql, /cost_per_unit IN \(0\.4536, 0\.6048\)/);
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 1);
});

test('the 19-credit Crun price stays unchanged and OpenRouter failover stays fail closed', () => {
  const setClause = sql.match(/UPDATE public\.model_routes\s+SET([\s\S]*?)\s+WHERE/i)?.[1] || '';
  assert.equal(Math.ceil(0.6048 / CAP), 34);
  assert.ok(0.6048 > 19 * CAP);
  assert.match(sql, /19 x \$0\.01796 = \$0\.34124/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i);
  assert.doesNotMatch(setClause, /\b(?:credits_5s|state|priority|provenance|margin_waiver_note)\b/i);
  assert.doesNotMatch(sql, /model_route_reorder/);
});
