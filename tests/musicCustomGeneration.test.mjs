import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../packages/db/schema/supabase/0477_music_custom_lyrics_generation.sql', import.meta.url);
const routeUrl = new URL('../app/api/v1/music/generation-quotes/route.js', import.meta.url);

test('Custom generation binds one saved paid-model draft and explicit lyric rights', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /mode IN \('simple','custom'\)/);
  assert.match(sql, /model_id = 'ace-step-1\.5'/);
  assert.match(sql, /p_rights_confirmed IS DISTINCT FROM true/);
  assert.match(sql, /WHERE user_id = v_user AND revision = p_draft_revision FOR SHARE/);
  assert.match(sql, /lyrics_rights_version = 'music-lyrics-rights-v1'/);
  assert.match(sql, /'prompt', v_spec\.styles, 'lyrics', v_spec\.lyrics/);
  assert.match(sql, /BEFORE INSERT ON public\.music_song_versions/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('Custom quote route reads the authoritative draft before policy and quote RPC', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /rpc\('music_get_custom_draft'/);
  assert.match(route, /customDraft\.revision !== input\.draftRevision/);
  assert.match(route, /musicPromptPolicy\(policyInput\)/);
  assert.match(route, /rpc\('music_create_custom_quote'/);
});
