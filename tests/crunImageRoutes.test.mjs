import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0388_crun_image_standby_routes.sql', 'utf8');
const CAP = 0.01796; // ADR-0037

test('both image routes are standby priority-2 Crun rows at 3 Crun credits, $0.0146', () => {
  assert.match(sql, /\('nano-banana-kie', 'crun:google\/nano-banana'\)/);
  assert.match(sql, /\('seedream-4', 'crun:bytedance\/seedream-4'\)/);
  assert.match(sql, /0\.0146::numeric/);
  assert.match(sql, /2, 'standby', 'licensed_reseller'/);
  assert.equal((3 / 206).toFixed(4), '0.0146');
  assert.match(sql, /<> 2 THEN/, 'it asserts exactly two rows');
});

test('the migration activates nothing and changes no price: a probe and the owner come first', () => {
  assert.doesNotMatch(sql, /state\s*=\s*'active'/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i);
  assert.doesNotMatch(sql, /model_route_reorder/);
});

test('at $0.0146 an image fits one credit under the 50% rule, so the later cut from 2 credits is safe', () => {
  assert.ok(0.0146 <= 1 * CAP);
  assert.ok(0.0146 > 0.5 * CAP, 'and the cost is not so low that a half credit would do');
});
