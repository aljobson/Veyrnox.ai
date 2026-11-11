import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../packages/db/schema/supabase/0460_music_version_lineage.sql', import.meta.url);

test('version lineage migration keeps versions immutable and owner-scoped', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'generation'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS parent_version_id UUID/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.music_version_sources/);
  assert.match(sql, /music_version_sources_output_owner_fk[\s\S]*FOREIGN KEY \(output_version_id, user_id\)/);
  assert.match(sql, /music_version_sources_source_owner_fk[\s\S]*FOREIGN KEY \(source_version_id, user_id\)/);
  assert.match(sql, /music_song_versions_parent_song_fk[\s\S]*FOREIGN KEY \(parent_version_id, user_id, song_id\)/);
  assert.match(sql, /music_songs_current_version_owner_fk[\s\S]*FOREIGN KEY \(current_version_id, user_id, id\)/);
  assert.match(sql, /music_song_versions_parent_not_self[\s\S]*parent_version_id <> id/);
  assert.match(sql, /CREATE TRIGGER music_song_versions_immutable[\s\S]*BEFORE UPDATE/);
  assert.match(sql, /CREATE TRIGGER music_version_sources_immutable[\s\S]*BEFORE UPDATE/);
  assert.match(sql, /CHECK \(output_version_id <> source_version_id\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /private\.music_owns_user\(user_id\)/);
  assert.match(sql, /'versions',[\s\S]*'lineage',[\s\S]*'actions'/);
  assert.match(sql, /jsonb_build_array\('view_lineage', 'organize'\)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_get_song\(TEXT,UUID\) TO service_role/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE).* TO authenticated/);
});
