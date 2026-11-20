import type { Playlist, PlaylistEdit } from './playlistTypes';
export const playlistIds = (playlist: Playlist) => playlist.songs.map(s => s.id);
export function addPlaylistSongs(ids: readonly string[], additions: readonly string[]) {
    const seen = new Set(ids.map(id => id.toLowerCase())), result = [...ids];
    for (const id of additions) if (!seen.has(id.toLowerCase()) && result.length < 100) { result.push(id); seen.add(id.toLowerCase()); }
    return result;
}
export const removePlaylistSong = (ids: readonly string[], id: string) => ids.filter(value => value !== id);
export function movePlaylistSong(ids: readonly string[], id: string, direction: -1 | 1) {
    const result = [...ids], index = result.indexOf(id), next = index + direction;
    if (index >= 0 && next >= 0 && next < result.length) [result[index], result[next]] = [result[next], result[index]];
    return result;
}
export const playlistReplace = (playlist: Playlist, songIds: readonly string[]): PlaylistEdit => ({ action: 'replace', expected_revision: playlist.revision, song_ids: [...songIds] });
