import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../packages/db/schema/supabase/0621_reactivate_verified_music_offer.sql', import.meta.url), 'utf8');

test('reactivates only the durable ace-step Music offer', () => {
  assert.match(migration, /UPDATE public\.model_catalog\s+SET active = true/);
  assert.match(migration, /WHERE id = 'ace-step'/);
  assert.match(migration, /ace-step-1\.5 must remain inactive until separately verified/);
  assert.doesNotMatch(migration, /id IN \('ace-step',\s*'ace-step-1\.5'\)/);
  assert.doesNotMatch(migration, /UPDATE public\.model_routes/i);
});

test('requires live worker, breaker, provider and margin gates', () => {
  assert.match(migration, /public\.crun_dispatch_health\(\)/);
  assert.match(migration, /task = 'crun_dispatch'[\s\S]*last_ok[\s\S]*last_success/);
  assert.match(migration, /breaker_opened_at IS NULL/);
  assert.match(migration, /public\.music_get_crun_availability\(\)/);
  assert.match(migration, /'suno_models'->>'v6'/);
  assert.match(migration, /credits_5s \* 0\.033 >= 2 \* provider_cost_per_unit/);
});

test('proves the actual create-to-library path instead of generic QA jobs', () => {
  for (const relation of [
    'music_generation_candidates',
    'music_generation_requests',
    'music_generation_quotes',
    'crun_dispatch',
  ]) assert.match(migration, new RegExp(`public\\.${relation}`), relation);
  assert.match(migration, /j\.state = 'STORED'/);
  assert.match(migration, /r\.status = 'succeeded'/);
  assert.match(migration, /q\.provider_contract = 'crun-suno-v1'/);
  assert.match(migration, /d\.provider_job_id = j\.provider_job_id/);
  assert.match(migration, /IF affected < 2 THEN/);
});
