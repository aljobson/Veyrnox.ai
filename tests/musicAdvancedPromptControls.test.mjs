import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../packages/db/schema/supabase/0475_music_advanced_prompt_controls.sql', import.meta.url);
const routeUrl = new URL('../app/api/v1/music/generation-quotes/route.js', import.meta.url);

test('advanced prompt controls are premium-only immutable provider inputs', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /style_influence BETWEEN 0 AND 100/);
  assert.match(sql, /char_length\(exclude_styles\) BETWEEN 1 AND 500/);
  assert.match(sql, /p_model_id IS DISTINCT FROM 'ace-step-1\.5'/);
  assert.match(sql, /round\(1 \+ v_style_influence::NUMERIC \* 0\.09, 2\)/);
  assert.match(sql, /jsonb_build_object\('lm_cfg_scale', v_style_guidance\)/);
  assert.match(sql, /jsonb_build_object\('lm_negative_prompt', v_exclude_styles\)/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('quote route passes only parser-normalized advanced snapshots to the RPC', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /p_style_influence: input\.styleInfluence/);
  assert.match(route, /p_exclude_styles: input\.excludeStyles/);
});
