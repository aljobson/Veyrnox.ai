import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMusicFeedback } from '../lib/musicFeedback.js';

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
