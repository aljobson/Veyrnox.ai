import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicLibraryTabsEnabled, parseMusicCoverChoice, parseMusicHook, parseMusicListen } from '../lib/musicLibraryTabs.js';

const ID = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';
const sqlUrl = new URL('../packages/db/schema/supabase/0523_music_library_tabs.sql', import.meta.url);

test('hook parser keeps a 5-30 s range and refuses extra keys', () => {
  const base = { song_id: ID, version_id: ID, title: ' Chorus ' };
  assert.deepEqual(parseMusicHook({ ...base, start_seconds: 10, end_seconds: 25 }), { ok: true, songId: ID, versionId: ID, title: 'Chorus', start: 10, end: 25 });
  assert.equal(parseMusicHook({ ...base, start_seconds: 0, end_seconds: 4 }).error, 'hook_range_invalid');
  assert.equal(parseMusicHook({ ...base, start_seconds: 0, end_seconds: 31 }).error, 'hook_range_invalid');
  assert.equal(parseMusicHook({ ...base, start_seconds: 0, end_seconds: 10, audio_url: 'x' }).error, 'invalid_request');
  assert.equal(parseMusicHook({ ...base, title: '', start_seconds: 0, end_seconds: 10 }).error, 'title_invalid');
});

test('listen and cover parsers accept only an id (or null to clear a cover)', () => {
  assert.equal(parseMusicListen({ song_id: ID }).ok, true);
  assert.equal(parseMusicListen({ song_id: ID, user_id: ID }).error, 'invalid_request');
  assert.deepEqual(parseMusicCoverChoice({ job_id: null }), { ok: true, jobId: null });
  assert.equal(parseMusicCoverChoice({ job_id: 'https://x' }).error, 'job_id_invalid');
});

test('Library tabs need the Library gate and their own switch, which ships false', async () => {
  const ready = { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true', MUSIC_LIBRARY_TABS_ENABLED: 'true' };
  assert.equal(musicLibraryTabsEnabled(ready), true);
  assert.equal(musicLibraryTabsEnabled({ ...ready, MUSIC_LIBRARY_TABS_ENABLED: 'false' }), false);
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.equal((wrangler.match(/\\"libraryTabs\\":false/g) || []).length, 2);
});

test('0523 keeps everything private, erased with the account and free of credit writes', async () => {
  const sql = await readFile(sqlUrl, 'utf8');
  for (const table of ['music_listen_history', 'music_hooks', 'music_song_covers']) assert.match(sql, new RegExp(`'${table}'`));
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /AFTER UPDATE OF deleted_at ON public\.users/);
  assert.match(sql, /AFTER UPDATE OF deleted_at ON public\.jobs/);
  assert.match(sql, /j\.deleted_at IS NULL/);
  assert.match(sql, /OFFSET 200/);
  assert.doesNotMatch(sql, /ledger_|credit_balances|model_catalog/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO (authenticated|anon)/);
});

test('hook route measures the stored audio before saving', async () => {
  const route = await readFile(new URL('../app/api/v1/music/hooks/route.js', import.meta.url), 'utf8');
  assert.match(route, /inspectStoredSource\(source\.r2_key/);
  assert.match(route, /p_duration: inspected\.seconds/);
});
