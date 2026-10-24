import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0387_crun_seedance_fast_first.sql', 'utf8');
const CAP = 0.01796; // ADR-0037: half of gross after the fee at the $129/3000 pack

test('the Seedance Fast cost is 66.86 Crun credits at the owner top-up rate, and 19 credits is its 50% floor', () => {
  const cost = 66.86 / 206;
  assert.equal(cost.toFixed(4), '0.3246');
  assert.equal(Math.ceil(cost / CAP), 19);
  assert.ok(cost <= 19 * CAP);
  assert.ok(cost > 18 * CAP, '18 credits would break the floor');
});

test('the migration records the audio fix and only what was verified, and asserts each step', () => {
  assert.match(sql, /crun:bytedance\/seedance2-0-fast-t2v/);
  assert.match(sql, /80967a17-4f33-4a02-bcc1-2f56d9a56499/);
  assert.match(sql, /eae4bdeb-29e2-4366-a365-780616a8aae0/);
  assert.match(sql, /audio:true/);
  assert.match(sql, /channel and model identity rest on Crun id/, 'what a clip cannot prove');
  assert.match(sql, /cost_per_unit = 0\.3246/);
  assert.match(sql, /credits_5s = 19/);
  assert.match(sql, /credits_5s IN \(26, 19\)/);
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2);
  assert.match(sql, /public\.model_route_reorder\(/);
});

test('the adapter sends audio for Seedance, so the clip matches the offer it backs', async () => {
  const { buildRequest } = await import('../packages/adapters/crun.js');
  assert.equal(buildRequest({ model: 'bytedance/seedance2-0-fast-t2v' }, { prompt: 'x' }).body.input.audio, true);
});
