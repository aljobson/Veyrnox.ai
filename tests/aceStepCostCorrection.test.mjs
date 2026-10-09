import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGISTRY as CAPABILITIES } from '../lib/modelCapabilities.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sql = read('../packages/db/schema/supabase/0236_ace_step_cost_matches_pin.sql')
  .split('\n').filter((line) => !line.startsWith('--')).join('\n');

// fal.ai/models/fal-ai/ace-step, read 2026-10-09: "$0.0002 per second of generated audio".
const FAL_USD_PER_SECOND = 0.0002;
const REFERENCE_USD_PER_CREDIT = 0.033;

test('the recorded cost is the published rate times the pinned track length', () => {
  const seconds = CAPABILITIES['fal-ai/ace-step'].fixed.duration;
  assert.equal(seconds, 60, 'a different pin needs a different recorded cost');
  assert.equal((FAL_USD_PER_SECOND * seconds).toFixed(4), '0.0120');
  assert.match(sql, /SET provider_cost_per_unit = 0\.0120, updated_at = now\(\)\n/);
});

test('only the cost moves: price, unit, billed length and activation are not assigned', () => {
  assert.equal((sql.match(/UPDATE public\.model_catalog/g) || []).length, 1);
  assert.doesNotMatch(sql, /SET[^;]*\b(credits_5s|cost_unit|billing_seconds|active)\s*=[^;]*WHERE/);
  assert.match(sql, /WHERE id = 'ace-step' AND provider = 'fal'/);
});

test('a replay matches the corrected row, and a row on another route, unit or cost fails loudly', () => {
  assert.match(sql, /AND provider_endpoint = 'fal-ai\/ace-step'/);
  assert.match(sql, /AND cost_unit = 'per_generation' AND billing_seconds IS NULL/);
  assert.match(sql, /AND provider_cost_per_unit IN \(0\.0100, 0\.0120\);/);
  assert.match(sql, /IF affected <> 1 THEN\s+RAISE EXCEPTION/);
});

test('one Credit still clears the 50% floor, at 63.6% where the old record showed 69.7%', () => {
  const margin = (cost) => (((REFERENCE_USD_PER_CREDIT - cost) / REFERENCE_USD_PER_CREDIT) * 100).toFixed(1);
  assert.equal(Math.ceil(0.012 / (REFERENCE_USD_PER_CREDIT / 2)), 1);
  assert.equal(margin(0.012), '63.6');
  assert.equal(margin(0.01), '69.7');
});

test('the static reference catalog records the same cost', () => {
  const row = /id: "ace-step",[\s\S]*?\n {4}\}/.exec(read('../packages/catalog/index.ts'))[0];
  assert.match(row, /provider_cost_usd: 0\.012,/);
  assert.match(row, /retail_usd: 0\.033,/);
});
