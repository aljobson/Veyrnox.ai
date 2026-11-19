import { ApiError, type ApiClient } from '../api';
import { isPlaylistList, isPlaylistCreate, isPlaylistReceipt, playlistTitle, playlistKey, playlistUuid, playlistRevision } from './validatePlaylists';
import type { PlaylistEdit } from './playlistTypes';
const BASE = '/api/v1/music/playlists';
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function listPlaylists(api: ApiClient) {
    const value = await api.request<unknown>(BASE);
    if (!isPlaylistList(value)) throw new ApiError(200, 'bad_response');
    return value.playlists;
}
export async function createPlaylist(api: ApiClient, title: string, key: string) {
    if (!playlistTitle(title)) throw new ApiError(400, 'title_invalid');
    if (!playlistKey(key)) throw new ApiError(400, 'idempotency_key_invalid');
    const value = await api.request<unknown>(BASE, json('POST', { title, idempotency_key: key }));
    // ApiClient returns the body only; successful status is not exposed (200 replay or 201 new).
    if (!isPlaylistCreate(value)) throw new ApiError(200, 'bad_response');
    return value.playlist;
}
async function patch(api: ApiClient, id: string, edit: PlaylistEdit, key: string) {
    if (!playlistUuid(id) || !playlistRevision(edit.expected_revision) || edit.expected_revision > 2147483647 || !playlistKey(key)) throw new ApiError(400, 'invalid_request');
    const value = await api.request<unknown>(`${BASE}/${encodeURIComponent(id)}`, json('PATCH', { ...edit, idempotency_key: key }));
    if (!isPlaylistReceipt(value)) throw new ApiError(200, 'bad_response');
    return value;
}
export function replacePlaylistSongs(api: ApiClient, id: string, revision: number, songIds: readonly string[], key: string) {
    if (songIds.length > 100 || !songIds.every(playlistUuid) || new Set(songIds.map(s => s.toLowerCase())).size !== songIds.length) throw new ApiError(400, 'song_ids_invalid');
    return patch(api, id, { action: 'replace', expected_revision: revision, song_ids: [...songIds] }, key);
}
export function setPlaylistPinned(api: ApiClient, id: string, revision: number, pinned: boolean, key: string) {
    if (typeof pinned !== 'boolean') throw new ApiError(400, 'invalid_request');
    return patch(api, id, { action: 'pin', expected_revision: revision, pinned }, key);
}
