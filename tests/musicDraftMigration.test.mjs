import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../packages/db/schema/supabase/0458_music_custom_drafts.sql', import.meta.url);

test('custom draft migration keeps ownership, revision and privilege guards', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /user_id UUID NOT NULL UNIQUE REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /CHECK \(char_length\(lyrics\) <= 3000\)/);
  assert.match(sql, /CHECK \(char_length\(styles\) <= 500\)/);
  assert.match(sql, /CHECK \(char_length\(title\) <= 80\)/);
  assert.match(sql, /CHECK \(revision >= 0\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /private\.music_owns_user\(user_id\)/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /'REVISION_CONFLICT'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.music_save_custom_draft\([^)]+\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_save_custom_draft\([^)]+\) TO service_role/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE).* TO authenticated/);
});
