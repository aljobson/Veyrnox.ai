import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../packages/db/schema/supabase/0611_retire_stalled_ace_audio_offers.sql', import.meta.url), 'utf8');

test('only the two live-SLA-failing ACE offers are retired', () => {
  assert.match(migration, /id IN \('ace-step', 'ace-step-1\.5'\) AND modality = 'text-to-audio'/);
  assert.match(migration, /SET active = false/);
  assert.match(migration, /IF affected <> 2 THEN/);
  assert.doesNotMatch(migration, /provider\s*=|provider_endpoint\s*=/);
  assert.doesNotMatch(migration, /qwen3-tts|suno-sounds/);
});

test('provider routes and in-flight settlement state remain untouched', () => {
  assert.doesNotMatch(migration, /UPDATE public\.model_routes/i);
  for (const table of ['jobs', 'job_attempts', 'assets', 'credit_holds', 'credit_ledger', 'credit_balances']) {
    assert.doesNotMatch(migration, new RegExp(`UPDATE public\\.${table}\\b`, 'i'), table);
  }
});

test('the production evidence and safe settlement intent are recorded', () => {
  assert.match(migration, /e15e93f1-8f83-4796-9120-793131cd01c1/);
  assert.match(migration, /8a5bcd3c-aeea-4947-84b7-e468c01dc932/);
  assert.match(migration, /more than 30 minutes/);
  assert.match(migration, /in-flight jobs can[\s\S]*finish or be refunded/);
});
