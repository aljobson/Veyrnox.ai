import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../packages/db/schema/supabase/0474_music_variety_control.sql', import.meta.url);
const quoteRouteUrl = new URL('../app/api/v1/music/generation-quotes/route.js', import.meta.url);

test('variety is frozen on the quote prompt and mapped to the documented provider range', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS variety SMALLINT/);
  assert.match(sql, /variety BETWEEN 0 AND 100/);
  assert.match(sql, /p_model_id IS DISTINCT FROM 'ace-step-1\.5'/);
  assert.match(sql, /WHEN v_variety <= 50 THEN round\(v_variety::NUMERIC \* 0\.017, 2\)/);
  assert.match(sql, /ELSE round\(0\.85 \+ \(v_variety - 50\)::NUMERIC \* 0\.023, 2\)/);
  assert.match(sql, /jsonb_build_object\('lm_temperature', v_temperature\)/);
  assert.match(sql, /BEFORE INSERT ON public\.fal_dispatch/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('quote route passes the validated snapshot value to the five-argument RPC', async () => {
  const route = await readFile(quoteRouteUrl, 'utf8');
  assert.match(route, /p_variety: input\.variety/);
});
