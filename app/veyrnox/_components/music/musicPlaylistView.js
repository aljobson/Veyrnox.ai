export function playlistSearchRows({ playlists = [], activeId = '', scope = 'active', query = '', shuffled = [] }) {
  const needle = String(query).trim().toLowerCase();
  const active = playlists.find((playlist) => playlist.id === activeId);
  const rows = scope === 'all'
    ? playlists.flatMap((playlist) => (playlist.songs || []).map((song) => ({
      ...song,
      playlist_id: playlist.id,
      playlist_title: playlist.title,
      row_key: `${playlist.id}:${song.id}`,
    })))
    : (shuffled.length ? shuffled : active?.songs || []).map((song) => ({
      ...song,
      playlist_id: active?.id,
      playlist_title: active?.title,
      row_key: `${active?.id || 'none'}:${song.id}`,
    }));
  return rows.filter((song) => !needle || String(song.title).toLowerCase().includes(needle)
    || (scope === 'all' && String(song.playlist_title).toLowerCase().includes(needle)));
}
