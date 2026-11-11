import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicRpcStatus, MUSIC_SHARED_CONCURRENCY_LIMIT } from '../lib/musicBackend.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0470_music_shared_concurrency.sql', import.meta.url);
const studioUrl = new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url);
const stateUrl = new URL('../app/veyrnox/_components/music/useMusicServerState.js', import.meta.url);

test('shared Music admission serializes owners and rejects a fifth active pair before debit', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.equal(MUSIC_SHARED_CONCURRENCY_LIMIT, 4);
  assert.equal(musicRpcStatus('CONCURRENCY_LIMIT'), 409);
  assert.match(sql, /WHERE u\.auth_id = p_auth_id[\s\S]*FOR UPDATE/);
  assert.match(sql, /r\.status IN \('debited', 'running'\)/);
  assert.match(sql, /IF v_active >= 4 THEN[\s\S]*'CONCURRENCY_LIMIT'/);
  assert.match(sql, /IF NOT v_replay THEN/);
  assert.match(sql, /RETURN private\.music_submit_pair_unbounded/);
  assert.match(sql, /REVOKE ALL ON FUNCTION private\.music_submit_pair_unbounded[\s\S]*service_role/);
});

test('client retains and independently polls multiple accepted pair requests', async () => {
  const [studio, state] = await Promise.all([readFile(studioUrl, 'utf8'), readFile(stateUrl, 'utf8')]);
  assert.match(state, /const \[generations, setGenerations\] = useState\(\[\]\)/);
  assert.match(state, /Promise\.all\(ids\.map/);
  assert.match(state, /\[accepted, \.\.\.current\.filter/);
  assert.match(studio, /Shared pairs \{activeGenerationCount\}\/\{concurrencyLimit\}/);
  assert.match(studio, /generations\.map\(\(generation, index\)/);
  assert.match(studio, /All four shared request slots are active/);
});
