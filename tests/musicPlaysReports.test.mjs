import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicPlaysEnabled, musicSongReportsEnabled, parseMusicPlay, parseMusicSongReport, parseMusicSongReportResolve, publicPlayCount } from '../lib/musicPlays.js';

const SLUG = 'a1b2c3d4e5f60718293a4b5c';
const sqlUrl = new URL('../packages/db/schema/supabase/0533_music_plays_and_song_reports.sql', import.meta.url);

test('play and report parsers accept only bounded public fields', () => {
  assert.deepEqual(parseMusicPlay({ action: 'count_play', slug: SLUG }), { ok: true, slug: SLUG });
  assert.equal(parseMusicPlay({ action: 'count_play', slug: SLUG, user_id: 'x' }).error, 'invalid_request');
  const ok = parseMusicSongReport({ action: 'report_song', slug: SLUG, category: 'rights', details: '  my recording  ', idempotency_key: 'song-report.0001' });
  assert.deepEqual(ok.payload, { action: 'report_song', slug: SLUG, category: 'rights', details: 'my recording' });
  assert.equal(parseMusicSongReport({ action: 'report_song', slug: SLUG, category: 'nope', details: 'abc', idempotency_key: 'song-report.0001' }).error, 'category_invalid');
  assert.equal(parseMusicSongReport({ action: 'report_song', slug: SLUG, category: 'spam', details: 'ab', idempotency_key: 'song-report.0001' }).error, 'details_invalid');
  assert.equal(parseMusicSongReport({ action: 'report_song', slug: SLUG, category: 'spam', details: 'abc' }).error, 'idempotency_key_invalid');
  assert.equal(parseMusicSongReportResolve({ action: 'resolve_song_report', id: 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c', reason: 'fine' }).ok, true);
  assert.equal(parseMusicSongReportResolve({ action: 'resolve_report', id: 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c', reason: 'fine' }).error, 'action_invalid');
  assert.equal(publicPlayCount({ play_count: '12', listeners: ['x'] }), 12);
});

test('both switches ship false and compose with publication', async () => {
  const ready = { MUSIC_RUNTIME_FLAGS: JSON.stringify({ ui: true, schema: true, library: true, distribution: true, publication: true }), MUSIC_PUBLICATION_ENABLED: 'true', MUSIC_PLAYS_ENABLED: 'true', MUSIC_SONG_REPORTS_ENABLED: 'true' };
  assert.equal(musicPlaysEnabled(ready), true);
  assert.equal(musicSongReportsEnabled(ready), true);
  assert.equal(musicPlaysEnabled({ ...ready, MUSIC_PLAYS_ENABLED: 'false' }), false);
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  // On in production and staging (owner, 2026-11-15).
  assert.equal((wrangler.match(/\\"plays\\":false,\\"songReports\\":false/g) || []).length, 0);
  assert.equal((wrangler.match(/\\"plays\\":true,\\"songReports\\":true/g) || []).length, 2);
});

test('0533 keeps who played private, dedupes, skips the creator and lets listeners delete their account', async () => {
  const sql = await readFile(sqlUrl, 'utf8');
  assert.match(sql, /interval '30 minutes'/);
  assert.match(sql, /IF v_pub\.user_id <> v_user THEN/);
  assert.match(sql, /'play_count', coalesce\(\(/);
  assert.match(sql, /'music_play_listens', 'music_song_reports'\)/);
  assert.match(sql, /AFTER UPDATE OF deleted_at ON public\.users/);
  assert.match(sql, /RAISE EXCEPTION 'not_admin'/);
  assert.doesNotMatch(sql, /ledger_|credit_balances/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO (authenticated|anon)/);
});

test('the public read carries only the total and the admin queue tolerates a missing 0533', async () => {
  const [pub, admin, comments] = await Promise.all([
    readFile(new URL('../app/api/music/public/[slug]/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/v1/admin/music-comments/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/v1/music/comments/route.js', import.meta.url), 'utf8'),
  ]);
  assert.match(pub, /plays: \{ count: publicPlayCount\(plays\) \}/);
  assert.match(admin, /music_song_report_list[\s\S]*\.catch\(\(\) => null\)/);
  assert.match(admin, /songReport \? 'music_song_report_resolve' : 'music_comment_review'/);
  assert.match(comments, /action === 'count_play'[\s\S]*music_count_public_play/);
  assert.match(comments, /action === 'report_song'[\s\S]*music_report_song/);
});
