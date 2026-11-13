import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../packages/db/schema/supabase/0459_music_private_workspaces.sql', import.meta.url);

test('private workspace migration pins ownership, defaulting and atomic move guards', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.music_workspaces/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.music_workspace_moves/);
  assert.match(sql, /music_workspaces_one_default_idx/);
  assert.match(sql, /music_workspaces_active_name_idx/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /private\.music_owns_user\(user_id\)/);
  assert.match(sql, /CREATE TRIGGER music_song_default_workspace/);
  assert.match(sql, /ALTER TABLE public\.music_songs ALTER COLUMN workspace_id SET NOT NULL/);
  assert.match(sql, /ORDER BY s\.id FOR UPDATE/);
  assert.match(sql, /REVISION_CONFLICT/);
  assert.match(sql, /idempotency_key = p_idempotency_key[\s\S]*'idempotent', true/);
  assert.match(sql, /s\.user_id = v_user AND s\.status = 'active'/);
  assert.match(sql, /EXCEPTION WHEN unique_violation THEN[\s\S]*idempotency_key = p_idempotency_key[\s\S]*'idempotent', true/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_move_songs\(TEXT,UUID,JSONB,TEXT\) TO service_role/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE).* TO authenticated/);
});
