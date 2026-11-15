import test from 'node:test';
import assert from 'node:assert/strict';
import { librarySongs } from '../app/veyrnox/_lib/music/beat/beatLibrarySongs.mjs';

// GET /music/songs forwards music_list_songs (0457) or music_library_songs (0468).
const song = { id: '11111111-1111-4111-8111-111111111111', title: 'My song', visibility: 'private',
  created_at: '2026-11-15T00:00:00Z', version_id: '22222222-2222-4222-8222-222222222222',
  job_id: '33333333-3333-4333-8333-333333333333',
  audio_url: '/api/v1/jobs/33333333-3333-4333-8333-333333333333/asset' };

test('song mapping uses the actual basic and expanded list payloads without inventing metadata', () => {
  const expanded = { ...song, workspace_id: '44444444-4444-4444-8444-444444444444', workspace_name: 'Music',
    revision: 1, updated_at: song.created_at, status: 'ready', lifecycle_status: 'active', feedback: null };
  for (const payload of [{ songs: [song] }, { songs: [expanded] }]) {
    assert.deepEqual(librarySongs(payload.songs), [{ id: `${song.id}:${song.version_id}`, source: 'song', name: 'My song', bpm: null,
      ref: { songId: song.id, versionId: song.version_id, jobId: song.job_id } }]);
  }
});
test('invalid UUID references are skipped and keys stay stable across order changes and duplicates', () => {
  for (const field of ['id', 'version_id', 'job_id']) {
    for (const value of [null, undefined, '', 'not-a-uuid']) assert.deepEqual(librarySongs([{ ...song, [field]: value }]), []);
  }
  const other = { ...song, version_id: '55555555-5555-4555-8555-555555555555', title: '' };
  const items = librarySongs([song, other, song, null]);
  assert.equal(items.length, 2); assert.equal(items[1].name, 'Untitled song');
  assert.deepEqual(librarySongs([other, song]).map((i) => i.id), items.map((i) => i.id).reverse());
});
