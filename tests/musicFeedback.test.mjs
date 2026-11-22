import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMusicFeedback } from '../lib/musicFeedback.js';

const FEEDBACK_ROUTE = new URL('../app/api/v1/music/songs/[id]/feedback/route.js', import.meta.url);
const FIXTURE_UUID = '2f8b0b5d-1d0a-4cb8-9ac0-4e5f83d8b042';

test('song feedback accepts only an exact private tri-state value', () => {
  assert.deepEqual(parseMusicFeedback({ value: 'like' }), { ok: true, value: 'like' });
  assert.deepEqual(parseMusicFeedback({ value: 'dislike' }), { ok: true, value: 'dislike' });
  assert.deepEqual(parseMusicFeedback({ value: null }), { ok: true, value: null });
  for (const value of ['love', '', 1, undefined]) assert.equal(parseMusicFeedback({ value }).error, 'feedback_invalid');
  assert.equal(parseMusicFeedback({ value: 'like', user_id: 'forged' }).error, 'invalid_request');
});

test('feedback migration binds owner and song while projecting the private collection', async () => {
  const sql = await readFile(new URL('../packages/db/schema/supabase/0466_music_song_feedback.sql', import.meta.url), 'utf8');
  assert.match(sql, /FOREIGN KEY \(song_id, user_id\) REFERENCES public\.music_songs\(id, user_id\)/);
  assert.match(sql, /p_value NOT IN \('like', 'dislike'\)/);
  assert.match(sql, /ON CONFLICT \(user_id, song_id\) DO UPDATE/);
  assert.match(sql, /LEFT JOIN public\.music_song_feedback f ON f\.song_id = s\.id AND f\.user_id = v_user/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.music_song_feedback FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_set_song_feedback\(TEXT,UUID,TEXT\) TO service_role/);
});

test('feedback route rejects oversized JSON through the shared bounded reader', async (t) => {
  const previous = {
    MUSIC_SCHEMA_ENABLED: process.env.MUSIC_SCHEMA_ENABLED,
    MUSIC_LIBRARY_ENABLED: process.env.MUSIC_LIBRARY_ENABLED,
  };
  Object.assign(process.env, { MUSIC_SCHEMA_ENABLED: 'true', MUSIC_LIBRARY_ENABLED: 'true' });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const { PUT } = await import(FEEDBACK_ROUTE);
  const response = await PUT(new Request(`https://veyrnox.test/api/v1/music/songs/${FIXTURE_UUID}/feedback`, {
    method: 'PUT',
    headers: { 'x-veyrnox-auth-id': FIXTURE_UUID, 'content-length': '1' },
    body: 'x'.repeat(8193),
  }), { params: Promise.resolve({ id: FIXTURE_UUID }) });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'body_too_large' });
});
