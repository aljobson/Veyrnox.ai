import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creditsForFloor, marginAt, MARGIN_FLOOR } from '../scripts/lib/fal-price-check.mjs';

// ADR-0037 amendment 2 (migration 0366). A catalog row may carry at most
// $0.01796 of provider cost per credit: after an 8% + $0.30 fee a credit sold
// at the $129/3000 pack leaves $0.03946, and half of its gross ($0.0215) stays.
const migration = readFileSync(new URL('../packages/db/schema/supabase/0366_whole_credit_price_floor.sql', import.meta.url), 'utf8');

const CUTS = [
  { id: 'elevenlabs-tts-turbo', cost: 0.05, was: 4, now: 3 },
  { id: 'elevenlabs-dialogue', cost: 0.1, was: 7, now: 6 },
  { id: 'minimax-speech-2.6-hd', cost: 0.1, was: 7, now: 6 },
  { id: 'nano-banana-pro-edit', cost: 0.15, was: 10, now: 9 },
  { id: 'veo-3.1-lite-kie', cost: 0.15, was: 10, now: 9 },
  { id: 'latentsync', cost: 0.2, was: 13, now: 12 },
  { id: 'kling-2.6-pro-kie', cost: 0.275, was: 17, now: 16 },
  { id: 'veo-3.1-fast-kie', cost: 0.3, was: 19, now: 17 },
  { id: 'wan-2.5-kie', cost: 0.3, was: 19, now: 17 },
  { id: 'kling-3.0-i2v-kie', cost: 0.45, was: 28, now: 26 },
  { id: 'seedance-2.0-fast', cost: 0.4536, was: 28, now: 26 },
  { id: 'kling-3.0-i2v', cost: 0.56, was: 34, now: 32 },
  { id: 'kling-avatar-v2', cost: 0.562, was: 35, now: 32 },
  { id: 'veo-3.1-kie', cost: 1.25, was: 76, now: 70 },
];

test('every cut is the smallest whole-credit price that keeps 50 percent', () => {
  for (const { id, cost, was, now } of CUTS) {
    assert.equal(creditsForFloor(cost), now, `${id} floor`);
    assert.ok(marginAt(cost, now) >= MARGIN_FLOOR, `${id} clears the floor at ${now}`);
    assert.ok(marginAt(cost, now - 1) < MARGIN_FLOOR, `${id} would breach at ${now - 1}`);
    assert.ok(now < was, `${id} is a cut`);
    // The same inequality the migration's trigger enforces, in integers.
    assert.ok(Math.round(cost * 100000) <= now * 1796, `${id} integer test`);
  }
});

test('the migration cuts exactly those rows, by identity, accepting the old or the new price', () => {
  const updates = [...migration.matchAll(/UPDATE public\.model_catalog SET credits_5s = (\d+), updated_at = now\(\)\s+WHERE id = '([^']+)'[\s\S]*?provider_cost_per_unit = ([\d.]+)[\s\S]*?credits_5s IN \((\d+), (\d+)\);/g)];
  assert.equal(updates.length, CUTS.length);
  for (const [, now, id, cost, was, again] of updates) {
    const cut = CUTS.find((c) => c.id === id);
    assert.ok(cut, `${id} is a planned cut`);
    assert.deepEqual([Number(now), Number(cost), Number(was), Number(again)], [cut.now, cut.cost, cut.was, cut.now], id);
  }
  // Each UPDATE is followed at once by its row-count check (README: new catalog UPDATEs).
  assert.equal((migration.match(/GET DIAGNOSTICS affected = ROW_COUNT;\s+IF affected <> 1 THEN/g) || []).length, CUTS.length);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.model_catalog/i);
});

test('the standing rule is the same inequality, with clip-edit counted for five seconds', () => {
  assert.match(migration, /CREATE TRIGGER model_catalog_margin_floor/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF active, credits_5s, provider_cost_per_unit, id ON public\.model_catalog/);
  assert.match(migration, /\* 100000\s+> NEW\.credits_5s::numeric \* 1796/);
  assert.match(migration, /NEW\.id = 'clip-edit' THEN NEW\.provider_cost_per_unit \* 5/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.model_catalog_margin_floor\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /SET search_path = ''/);
  // Every active row is checked once when the migration runs.
  assert.match(migration, /Active catalog rows below the 50 percent floor/);
});

test('the watcher and the database agree on one floor', () => {
  // marginAt(cost, credits) >= 50% exactly when cost <= credits * 0.01796.
  for (const credits of [1, 2, 3, 9, 32, 70, 165]) {
    const edge = credits * 0.01796;
    assert.ok(marginAt(edge, credits) >= MARGIN_FLOOR - 1e-9, `${credits} at its edge`);
    assert.ok(marginAt(edge * 1.001, credits) < MARGIN_FLOOR, `${credits} just over`);
  }
});
