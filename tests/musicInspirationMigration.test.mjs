import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(new URL('../packages/db/schema/supabase/0608_music_audio_inspiration.sql', import.meta.url), 'utf8');

test('0608 serializes quota, consumes each source once and fences stale attempts', () => {
  assert.match(sql, /music-inspiration-quota/);
  assert.match(sql, /UNIQUE\(user_id,upload_key\)/);
  assert.match(sql, /status='pending' AND attempt_id=p_attempt_id/g);
  assert.match(sql, /attempt_count>=3/);
  assert.match(sql, /attempt_count=attempt_count\+1/);
  assert.match(sql, /p_lease_seconds<80 OR p_lease_seconds>120/);
  assert.match(sql, /IDEMPOTENCY_CONFLICT/);
  assert.match(sql, /SOURCE_ALREADY_USED/);
});

test('0608 erases content-derived rows and exposes no client table access', () => {
  assert.match(sql, /DELETE FROM public\.music_inspiration_requests WHERE user_id=NEW\.id/);
  assert.match(sql, /users_music_inspiration_forget_erased/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.music_inspiration_requests FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(sql, /GRANT .*music_inspiration_requests TO (?:anon|authenticated)/);
});
