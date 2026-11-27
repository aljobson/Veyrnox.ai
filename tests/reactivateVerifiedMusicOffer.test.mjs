import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../packages/db/schema/supabase/0621_reactivate_verified_music_offer.sql', import.meta.url), 'utf8');

test('reactivates only the durable ace-step Music offer', () => {
  assert.match(migration, /UPDATE public\.model_catalog\s+SET active = true/);
  assert.match(migration, /credits_5s = 4/);
  assert.match(migration, /credits_5s IN \(2, 4\)/);
  assert.match(migration, /WHERE id = 'ace-step'/);
  assert.match(migration, /ace-step-1\.5 must remain inactive until separately verified/);
  assert.doesNotMatch(migration, /id IN \('ace-step',\s*'ace-step-1\.5'\)/);
  assert.match(migration, /UPDATE public\.model_routes[\s\S]*WHERE model_id = 'ace-step'/i);
  assert.match(migration, /public\.model_route_reorder\(/);
});

test('keeps deterministic route and margin assertions', () => {
  assert.match(migration, /breaker_opened_at IS NULL/);
  assert.match(migration, /credits_5s \* 0\.033 >= 2 \* provider_cost_per_unit/);
});

test('does not depend on production history or live worker state', () => {
  for (const runtimeRelation of [
    'public.jobs',
    'public.worker_task_health',
    'public.music_generation_candidates',
    'public.music_generation_requests',
    'public.music_generation_quotes',
    'public.crun_dispatch',
  ]) assert.doesNotMatch(migration, new RegExp(runtimeRelation.replace('.', '\\.')), runtimeRelation);
  assert.doesNotMatch(migration, /public\.crun_dispatch_health\(\)/);
  assert.doesNotMatch(migration, /public\.music_get_crun_availability\(\)/);
});
