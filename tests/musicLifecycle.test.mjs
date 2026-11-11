import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMusicSongLifecycle } from '../lib/musicBackend.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0468_music_song_lifecycle.sql', import.meta.url);
const listRouteUrl = new URL('../app/api/v1/music/songs/route.js', import.meta.url);
const detailRouteUrl = new URL('../app/api/v1/music/songs/[id]/route.js', import.meta.url);

test('song lifecycle parser accepts only exact reversible revision-bound actions', () => {
  assert.deepEqual(parseMusicSongLifecycle({ action: 'trash', revision: 0 }), {
    ok: true, action: 'trash', revision: 0,
  });
  assert.deepEqual(parseMusicSongLifecycle({ action: 'restore', revision: 2_147_483_647 }), {
    ok: true, action: 'restore', revision: 2_147_483_647,
  });
  assert.equal(parseMusicSongLifecycle({ action: 'delete', revision: 0 }).error, 'action_invalid');
  assert.equal(parseMusicSongLifecycle({ action: 'trash', revision: -1 }).error, 'revision_invalid');
  assert.equal(parseMusicSongLifecycle({ action: 'trash', revision: 0, user_id: crypto.randomUUID() }).error, 'invalid_request');
});

test('song lifecycle migration locks owner rows and makes target-state retries idempotent', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /music_set_song_lifecycle[\s\S]*WHERE id = p_song_id AND user_id = v_user FOR UPDATE/);
  assert.match(sql, /IF v_song\.status = v_target THEN[\s\S]*'idempotent', true/);
  assert.match(sql, /IF v_song\.revision <> p_revision THEN[\s\S]*REVISION_CONFLICT/);
  assert.match(sql, /SET status = v_target, revision = revision \+ 1/);
  assert.doesNotMatch(sql, /DELETE FROM public\.music_songs/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]* TO authenticated/);
});

test('song lifecycle routes expose trash explicitly and keep permanent deletion absent', async () => {
  const [listRoute, detailRoute] = await Promise.all([
    readFile(listRouteUrl, 'utf8'), readFile(detailRouteUrl, 'utf8'),
  ]);
  assert.match(listRoute, /collection === 'trash' \? 'trashed' : 'active'/);
  assert.match(detailRoute, /export async function PATCH/);
  assert.match(detailRoute, /music_set_song_lifecycle/);
  assert.doesNotMatch(detailRoute, /export async function DELETE/);
});
