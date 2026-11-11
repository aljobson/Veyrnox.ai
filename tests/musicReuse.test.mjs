import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicReuseEnabled, parseMusicReuseDraft } from '../lib/musicBackend.js';

const VERSION = '92ed2d0d-8276-4fbb-9c4f-39f401a3158b';
const migrationUrl = new URL('../packages/db/schema/supabase/0484_music_reuse_draft.sql', import.meta.url);
const routeUrl = new URL('../app/api/v1/music/songs/[id]/reuse/route.js', import.meta.url);
const dialogUrl = new URL('../app/veyrnox/_components/music/MusicReuseDialog.jsx', import.meta.url);

test('Reuse parser binds exact source, draft revision, selected fields and replay key', () => {
  assert.deepEqual(parseMusicReuseDraft({
    version_id: VERSION, draft_revision: 4, reuse_lyrics: true, reuse_styles: false,
    idempotency_key: 'reuse.owned-version',
  }), {
    ok: true, versionId: VERSION, draftRevision: 4, reuseLyrics: true,
    reuseStyles: false, idempotencyKey: 'reuse.owned-version',
  });
  assert.equal(parseMusicReuseDraft({ version_id: VERSION, draft_revision: 4, reuse_lyrics: false, reuse_styles: false, idempotency_key: 'reuse.none' }).error, 'reuse_selection_invalid');
  assert.equal(parseMusicReuseDraft({ version_id: VERSION, draft_revision: 4, reuse_lyrics: true, reuse_styles: false, idempotency_key: 'reuse.exact', extra: true }).error, 'invalid_request');
});

test('Reuse rollout composes schema, Library and its independent flag', () => {
  const ready = { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_REUSE_ENABLED: 'true' };
  assert.equal(musicReuseEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicReuseEnabled({ ...ready, [key]: 'false' }), false, key);
});

test('Reuse migration copies only owned current prompt material with optimistic replay safety', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /s\.current_version_id=p_version_id/);
  assert.match(sql, /v_draft\.revision IS DISTINCT FROM p_expected_revision/);
  assert.match(sql, /lyrics=CASE WHEN p_reuse_lyrics THEN v_lyrics ELSE lyrics END/);
  assert.match(sql, /styles=CASE WHEN p_reuse_styles THEN v_styles ELSE styles END/);
  assert.match(sql, /UNIQUE\(user_id,idempotency_key\)/);
  assert.match(sql, /result_draft JSONB NOT NULL/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('Reuse route never accepts copied text or a browser source URL', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /music_get_reuse_draft_context/);
  assert.match(route, /music_apply_reuse_to_draft/);
  assert.match(route, /p_source_version_id|p_version_id: input\.versionId/);
  assert.doesNotMatch(route, /p_lyrics|p_styles|audio_url/);
});

test('Reuse UI discloses no spend and revision-safe selected-field replacement', async () => {
  const dialog = await readFile(dialogUrl, 'utf8');
  assert.match(dialog, /creates no audio, spends no credits and does not alter the source song/);
  assert.match(dialog, /Only selected fields are replaced/);
  assert.match(dialog, /A stale draft revision is refused instead of overwritten/);
  assert.match(dialog, /Open reused Custom draft/);
});
