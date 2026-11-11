import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MUSIC_REPLACE_DURATION_MAX, MUSIC_REPLACE_RANGE_MAX, musicReplaceEnabled,
  parseMusicReplaceCommit, parseMusicReplaceQuote,
} from '../lib/musicBackend.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0482_music_replace_section.sql', import.meta.url);
const quoteRouteUrl = new URL('../app/api/v1/music/songs/[id]/replace-quotes/route.js', import.meta.url);
const confirmRouteUrl = new URL('../app/api/v1/music/songs/[id]/replacements/route.js', import.meta.url);
const commitRouteUrl = new URL('../app/api/v1/music/songs/[id]/replacements/commit/route.js', import.meta.url);
const dialogUrl = new URL('../app/veyrnox/_components/music/MusicReplaceSectionDialog.jsx', import.meta.url);
const commitMigrationUrl = new URL('../packages/db/schema/supabase/0483_music_replace_take_commit.sql', import.meta.url);
const VERSION = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';

test('Replace parser freezes an exact bounded range and rights evidence', () => {
  assert.equal(MUSIC_REPLACE_DURATION_MAX, 60);
  assert.equal(MUSIC_REPLACE_RANGE_MAX, 30);
  assert.deepEqual(parseMusicReplaceQuote({ version_id: VERSION, prompt: '  sparse bridge  ', start_seconds: 10.5, end_seconds: 21, rights_confirmed: true }), {
    ok: true, versionId: VERSION, prompt: 'sparse bridge', startSeconds: 10.5, endSeconds: 21, rightsConfirmed: true,
  });
  assert.equal(parseMusicReplaceQuote({ version_id: VERSION, prompt: 'x', start_seconds: 10, end_seconds: 41, rights_confirmed: true }).error, 'range_invalid');
  assert.equal(parseMusicReplaceQuote({ version_id: VERSION, prompt: 'x', start_seconds: 10, end_seconds: 20, rights_confirmed: true, audio_url: 'https://attacker.invalid' }).error, 'invalid_request');
});

test('Replace take commit binds one ready version to its exact generation and replay key', () => {
  assert.deepEqual(parseMusicReplaceCommit({
    generation_id: 'a6ed2d0d-8276-4fbb-9c4f-39f401a3158c',
    version_id: VERSION,
    idempotency_key: 'replace-commit.exact-version',
  }), {
    ok: true,
    generationId: 'a6ed2d0d-8276-4fbb-9c4f-39f401a3158c',
    versionId: VERSION,
    idempotencyKey: 'replace-commit.exact-version',
  });
  assert.equal(parseMusicReplaceCommit({ generation_id: VERSION, version_id: VERSION, idempotency_key: 'short' }).error, 'idempotency_key_invalid');
  assert.equal(parseMusicReplaceCommit({ generation_id: VERSION, version_id: VERSION, idempotency_key: 'replace-commit.exact', extra: true }).error, 'invalid_request');
});

test('Replace rollout composes all durable Music gates', () => {
  const ready = { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_GENERATION_ENABLED: 'true', FAL_DISPATCH_SCHEMA_ENABLED: 'true', MUSIC_REPLACE_ENABLED: 'true' };
  assert.equal(musicReplaceEnabled(ready), true);
  for (const key of Object.keys(ready)) assert.equal(musicReplaceEnabled({ ...ready, [key]: 'false' }), false, key);
});

test('Replace migration stages exact pricing, provider range and immutable alternates', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /'ace-step-replace-section'.*'fal-ai\/ace-step\/audio-inpaint'.*1,0\.0120/s);
  assert.match(sql, /'start_time_relative_to','start'.*'start_time',v_prompt\.replace_start_seconds/s);
  assert.match(sql, /'end_time_relative_to','start','end_time',v_prompt\.replace_end_seconds/);
  assert.match(sql, /'tags',v_prompt\.prompt,'lyrics','\[instrumental\]','variance',0\.5/);
  assert.match(sql, /ELSE 'replace_section' END/);
  assert.match(sql, /ELSE 'edit_source' END/);
  assert.match(sql, /'provider_job_id',v_job\.provider_job_id/);
  assert.match(sql, /failure_code=v_job\.error_code/);
  assert.match(sql, /ACCOUNT_FROZEN/);
  assert.match(sql, /v_quote\.total_credits<>2/);
  assert.match(sql, /v_recent>8/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('Replace routes measure and sign only the server-owned current source', async () => {
  const [quote, confirm] = await Promise.all([readFile(quoteRouteUrl, 'utf8'), readFile(confirmRouteUrl, 'utf8')]);
  assert.match(quote, /input\.endSeconds > inspected\.seconds/);
  assert.match(quote, /p_source_duration_seconds: inspected\.seconds/);
  assert.match(confirm, /inspectStoredSource\(context\.r2_key/);
  assert.match(confirm, /p_source_audio_url: inspected\.url/);
  assert.match(confirm, /Math\.abs\(inspected\.seconds - Number\(context\.source_duration_seconds\)\) > 0\.1/);
});

test('Replace take lane commits exactly one ready branch and preserves its siblings', async () => {
  const [dialog, sql, route] = await Promise.all([
    readFile(dialogUrl, 'utf8'), readFile(commitMigrationUrl, 'utf8'), readFile(commitRouteUrl, 'utf8'),
  ]);
  assert.match(dialog, /two instrumental alternatives/i);
  assert.match(dialog, /Audition both full-song takes, then commit one as current/);
  assert.match(dialog, /Use alternative .* as current/);
  assert.match(sql, /UNIQUE\(user_id,generation_request_id\)/);
  assert.match(sql, /c\.status='ready'.*v\.operation='replace_section'.*v\.parent_version_id=v_source/s);
  assert.match(sql, /UPDATE public\.music_songs SET current_version_id=p_version_id/);
  assert.match(sql, /'version_id',c\.song_version_id/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
  assert.match(route, /music_commit_replace_take/);
});
