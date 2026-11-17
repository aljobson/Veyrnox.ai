import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capabilityFor, lengthsFor } from '../lib/modelCapabilities.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { MODELS } from '../app/veyrnox/_lib/tokens.js';
import { TOOL_TASKS } from '../app/veyrnox/_lib/tools.js';
import { creditsForFloor, marginAt, MARGIN_FLOOR } from '../scripts/lib/fal-price-check.mjs';

const PRO = 'fal-ai/kling-video/v3/pro/image-to-video';
const STANDARD = 'fal-ai/kling-video/v3/standard/image-to-video';

test('Standard sends exactly what Pro sends: same fields, audio off, 5 or 10 s', () => {
  const pro = capabilityFor(PRO);
  const standard = capabilityFor(STANDARD);
  assert.ok(standard);
  assert.deepEqual(standard, pro);
  assert.deepEqual(lengthsFor(standard), [5, 10]);
  assert.deepEqual(standard.fixed, { generate_audio: false });
  assert.equal(standard.tiers, undefined);
});

test('the browser fallback resolves the staged row and keeps it out of public lists', () => {
  assert.deepEqual(fallbackCapabilitiesFor('kling-3.0-standard-i2v'), fallbackCapabilitiesFor('kling-3.0-i2v'));
  const row = MODELS.find((m) => m.id === 'kling-3.0-standard-i2v');
  assert.equal(row.staged, true);
  assert.deepEqual(row.durations, lengthsFor(capabilityFor(STANDARD)));
  const pro = MODELS.find((m) => m.id === 'kling-3.0-i2v');
  assert.equal(pro.credits, 32, 'Pro price is unchanged');
  assert.ok(!pro.staged);
});

test('Photo to video lists Pro first, so the default is unchanged', () => {
  const ids = TOOL_TASKS.find((t) => t.key === 'animate').ids;
  assert.equal(ids[0], 'kling-3.0-i2v');
  assert.ok(ids.includes('kling-3.0-standard-i2v'));
});

test('migration 0556 stages the row inactive at the floor price from fal\'s page cost', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0556_kling_v3_standard_i2v_staged.sql', import.meta.url), 'utf8');
  const row = sql.match(/'image-to-video', (\d+), ([\d.]+), 'per_second', 5, false, false\)/);
  assert.ok(row, 'inactive five-second unit');
  const credits = Number(row[1]);
  const cost = Number(row[2]);
  assert.equal(cost, +(5 * 0.084).toFixed(4));
  assert.equal(credits, 24);
  assert.equal(creditsForFloor(cost), credits);
  assert.ok(marginAt(cost, credits) >= MARGIN_FLOOR);
  assert.ok(marginAt(cost, credits - 1) < MARGIN_FLOOR);
  assert.equal(credits * 2, 48);
  assert.ok(credits < 32, 'cheaper than Pro');
  assert.doesNotMatch(sql, /UPDATE\s+public\.model_catalog/i);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
});
