import test from 'node:test';
import assert from 'node:assert/strict';
import { playlistSearchRows } from '../app/veyrnox/_components/music/musicPlaylistView.js';

const playlists = [
  { id: 'a', title: 'Film cues', songs: [{ id: '1', title: 'Dawn Index' }] },
  { id: 'b', title: 'Night work', songs: [{ id: '2', title: 'Harbour Light' }] },
];

test('playlist search stays scoped until the owner explicitly searches all collections', () => {
  assert.deepEqual(playlistSearchRows({ playlists, activeId: 'a', query: 'harbour' }), []);
  assert.deepEqual(playlistSearchRows({ playlists, activeId: 'a', scope: 'all', query: 'harbour' }).map((row) => row.row_key), ['b:2']);
  assert.deepEqual(playlistSearchRows({ playlists, activeId: 'a', scope: 'all', query: 'film' }).map((row) => row.row_key), ['a:1']);
  assert.deepEqual(playlistSearchRows({ playlists, activeId: 'a', scope: 'all' }).map((row) => row.row_key), ['a:1', 'b:2']);
});
