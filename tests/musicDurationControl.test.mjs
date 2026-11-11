import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../packages/db/schema/supabase/0476_music_duration_control.sql', import.meta.url);
const routeUrl = new URL('../app/api/v1/music/generation-quotes/route.js', import.meta.url);

test('duration is quote-frozen and capped inside the existing 60-second price tier', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /duration_seconds BETWEEN 10 AND 60/);
  assert.match(sql, /p_duration_seconds NOT BETWEEN 10 AND 60/);
  assert.match(sql, /SET duration_seconds = p_duration_seconds/);
  assert.match(sql, /jsonb_build_object\('duration', v_duration_seconds\)/);
  assert.match(sql, /NEW\.endpoint NOT IN \('fal-ai\/ace-step', 'fal-ai\/ace-step-1\.5'\)/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('quote route passes the parser-normalized duration to the eight-argument RPC', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /p_duration_seconds: input\.durationSeconds/);
});
