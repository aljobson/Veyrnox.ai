import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// 0508: delete_user_job refused every creation sent through durable dispatch, because
// it required fal_dispatch.state = 'CLOSED' and nothing moves an accepted request there.
// Music jobs now answer USED_BY_MUSIC instead of failing on a foreign key.
const DIR = new URL('../packages/db/schema/supabase/', import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), 'utf8');
const code = read('0508_library_delete_settled_jobs.sql').split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

test('a settled job with an accepted or rejected fal request is no longer refused as in progress', () => {
  assert.match(code, /d\.state NOT IN \('CLOSED', 'ACCEPTED', 'REJECTED'\)/);
  assert.doesNotMatch(code, /d\.state <> 'CLOSED'/);
  assert.match(code, /v_job\.state NOT IN \('STORED', 'FAILED', 'REFUNDED'\)/);
});

test('nothing outside job cancel and never-sent rows closes an accepted fal request', () => {
  // The premise of 0508: if a later migration starts closing accepted rows, revisit this rule.
  const closers = [];
  for (const name of ['0230_fal_durable_dispatch.sql', '0359_job_cancel.sql']) {
    if (/SET state = 'CLOSED'/.test(read(name))) closers.push(name);
  }
  assert.deepEqual(closers, ['0230_fal_durable_dispatch.sql', '0359_job_cancel.sql']);
  assert.match(read('0230_fal_durable_dispatch.sql'), /SET state = 'CLOSED'[^;]*AND state = 'READY'/);
});

test('every Music link to a job or its file answers USED_BY_MUSIC, before any asset is deleted', () => {
  for (const ref of [
    'public.music_song_versions v WHERE v.job_id = v_job.id',
    'public.music_generation_candidates c WHERE c.job_id = v_job.id',
    'public.music_stem_requests r WHERE r.job_id = v_job.id',
    'public.music_target_stem_requests r WHERE r.job_id = v_job.id',
    'r.track_job_id = v_job.id OR r.upload_job_id = v_job.id',
    'ON v.audio_asset_id = a.id',
    'a.id IN (t.target_asset_id, t.residual_asset_id)',
  ]) assert.ok(code.includes(ref), ref);
  assert.ok(code.indexOf("'USED_BY_MUSIC'") < code.indexOf('DELETE FROM public.assets'));
});

test('the rest of 0450 is kept: holds, other uses, the prompt scrub and privileges', () => {
  for (const kept of ["'ON_HOLD'", "'USED_BY_POST'", "'USED_BY_CINEMA'", "'USED_BY_LIBRARY'", "'ACCOUNT_FROZEN'",
    "UPDATE public.fal_dispatch SET payload = '{}'::jsonb", "SET search_path = ''"]) assert.ok(code.includes(kept), kept);
  assert.doesNotMatch(code, /ledger_entries|credit_balances/);
  assert.ok(code.includes('REVOKE ALL ON FUNCTION public.delete_user_job(TEXT,UUID) FROM PUBLIC, anon, authenticated;'));
  assert.ok(code.includes('GRANT EXECUTE ON FUNCTION public.delete_user_job(TEXT,UUID) TO service_role;'));
});

test('the route maps USED_BY_MUSIC to 409 used_by_music', () => {
  const route = readFileSync(new URL('../app/api/v1/jobs/[id]/route.js', import.meta.url), 'utf8');
  assert.match(route, /USED_BY_MUSIC: \[409, 'used_by_music'\]/);
});

test('the push sweep skips local renders and keeps its other exclusions', () => {
  assert.match(code, /^CREATE OR REPLACE FUNCTION public\.push_enqueue_job_events\(/m);
  assert.match(code, /AND COALESCE\(j\.provider, ''\) <> 'local'/);
  assert.match(code, /AND COALESCE\(j\.provider, ''\) <> 'openrouter-chat'/);
  assert.match(code, /j\.error_code IS DISTINCT FROM 'user_cancelled'/);
  assert.match(code, /j\.inputs->>'kind' IS DISTINCT FROM 'speech_analysis'/);
});
