import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../packages/db/schema/supabase/0478_music_custom_instrumental.sql', import.meta.url);
const routeUrl = new URL('../app/api/v1/music/generation-quotes/route.js', import.meta.url);

test('Custom instrumental quote stores an exclusive vocal mode and dispatches the provider marker', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /p_instrumental BOOLEAN/);
  assert.match(sql, /p_instrumental AND p_rights_confirmed IS DISTINCT FROM false/);
  assert.match(sql, /NOT p_instrumental AND p_rights_confirmed IS DISTINCT FROM true/);
  assert.match(sql, /instrumental AND lyrics IS NULL AND lyrics_rights_version IS NULL/);
  assert.match(sql, /NOT instrumental AND lyrics IS NOT NULL/);
  assert.match(sql, /CASE WHEN v_spec\.instrumental THEN '\[Instrumental\]' ELSE v_spec\.lyrics END/);
  assert.match(sql, /'instrumental', v_spec\.instrumental/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('Custom instrumental policy and RPC use the frozen request mode', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /policyInput = input\.instrumental/);
  assert.match(route, /p_instrumental: input\.instrumental/);
});
